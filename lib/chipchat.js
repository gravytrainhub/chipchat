/**
   ChipChat - ChatShipper SDK Main module
   @module ChipChat
   @author Chatshipper
*/

'use strict';

const debug         = require('debug')('chipchat:core');
const EventEmitter2 = require('eventemitter2');
const mware         = require('mware').default;
const jwt           = require('jsonwebtoken');
const RestAPI       = require('./client');
const Server        = require('./server');
const { getSignature } = require('./utils');

/**
 * Middleware that ignores messages from this bot user (self).
 *
 * @api private
 */
function ignoreSelfMiddleware() {
    return (bot, payload, next) => {
        if (!payload.event) {
            console.log('invalidpayload', JSON.stringify(payload));
            bot.emit('error', { message: 'Invalid payload' });
            return;
        }
        if (payload.event.startsWith('message')
            && payload.data.message.user === bot.auth.user
        ) {
            debug('ignoreSelf', payload.data.message.text);
            return;
        }
        next();
    };
}

/**
 * Middleware that ignores messages from any bot user
 *
 * @api private
 */
function ignoreBotsMiddleware() {
    return (bot, payload, next) => {
        if (!payload.event) {
            console.log('invalidpayload', JSON.stringify(payload));
            bot.emit('error', { code: 'Invalid payload' });
            return;
        }
        if (payload.event.startsWith('message')
            && payload.data.message.role === 'bot'
        ) {
            debug('ignoreBots');
            return;
        }
        next();
    };
}

function matcher(value, test) {
    if (typeof test === 'string' || typeof test === 'number' || typeof test === 'boolean') {
        return value === test;
    }
    if (Array.isArray(test)) {
        return test.reduce((acc, curr) => {
            return matcher(value, curr) ? true : acc;
        }, false);
    }
    if (test instanceof RegExp) {
        return test.test(value);
    }
    debug('invalid matcher', typeof test);
    return false;
}

function match(c, m, conditionals) {
    const reducer = (accumulator, current) => {
        if (accumulator) {
            if (m[current] && matcher(m[current], conditionals[current])) {
                return true;
            }
            if (current.startsWith('@') && matcher(c[current.replace(/^@/, '')], conditionals[current])) {
                return true;
            }
            if (c.meta && matcher(c.meta[current], conditionals[current])) {
                return true;
            }
            return false;
        }
        //debug('nomatch - prevmatch', accumulator);
        return false;
    };
    return Object.keys(conditionals).length
        ? Object.keys(conditionals).reduce(reducer, true)
        : true;
}

/**
   Create a new ChipChat bot
   @class
   @mixes RestAPI
   @mixes Server
   @mixes EventEmitter
   @extends RestAPI
   @extends Server
   @extends EventEmitter

*/
class ChipChat extends RestAPI(Server(EventEmitter2)) {
    /**
     * Attach new methods to the ChipChat class
     * @param {array} methods
     * @static
     * @example
     * ````
     * ChipChat.mixin({
     *     foo: c => c.say('Okidoki')
     * });
     * const bot = new ChipChat({
     *     token: process.env.TOKEN
     * });
     * bot.on('message', (m, c) => bot.foo(c));
     * ````
     */
    static mixin(methods) {
        Object.keys(methods).forEach((method) => {
            this.prototype[method] = methods[method];
        });
    }

    /**
       Create a new ChipChat instance
       @param {object} options - Constructor Options
       @param {string} [options.token] - Chatshipper API Token, REQUIRED
       @param {string} [options.secret] - Chatshipper Application Secret
       @param {string} [options.host] - Target Chatshipper API server, defaults to https://api.chatshipper.com
       @param {string} [options.webhook] - Webhook path segment, defaults to '/'. Only used by
        the 'start' method.
       @param {boolean} [options.ignoreSelf=true] - ignore any messages from yourself.
       @param {boolean} [options.ignoreBots=true] - ignore any messages from other bot users
       @param {boolean} [options.preloadOrganizations=false] -
       @param {boolean} [options.onlyFirstMatch=false] - Set to true to stop after first match.
         Otherwise, all regexps are executed.
       @param {string} [options.middleware] - Middleware stack functions
       @param {function}|{array} options.middleware.send - A function or a list of functions for the
         outbound pipeline
       @param {function}|{array} options.middleware.receive - A function or a list of functions for
         the inbound pipeline
     */
    constructor(options = {}) {
        super();

        EventEmitter2.call(this, {
            wildcard: true
        });

        const opts = options || {};
        //if (!opts.token) {
        //    throw new Error('Missing auth token');
        //}

        /**
         * @property {string} token The API bearer token.
         */
        this.token = opts.token;
        /**
         * @property {string} secret The webhook payload verification secret.
         */
        this.secret = opts.secret || process.env.SECRET || false;
        /**
         * @property {string} host The API host.
         */
        this.host = opts.host || process.env.APIHOST || 'https://api.chatshipper.com';

        if (opts.token) {
            const decoded = jwt.decode(opts.token, { complete: true });
            if (decoded) {
                const { _id, organization, iat, exp } = decoded.payload;
                /**
                 * Authenticated user, organization, and token issued-at and expiration times.
                 * Only set when a token was specified.
                 * @name ChipChat#auth
                 * @type {object}
                 */
                this.auth = { user: _id, organization, iat, exp };
            } else {
                debug(`invalid / unrecognised token '${options.token}'`);
            }
        }

        this.preloadOrganizations = typeof opts.preloadOrganizations === 'boolean' ? opts.preloadOrganizations : false;
        this.onlyFirstMatch = typeof opts.onlyFirstMatch === 'boolean' ? opts.onlyFirstMatch : false;

        this.middleware = {
            receive: mware(),
            send: mware()
        };
        this.ignoreBots = typeof opts.ignoreBots === 'boolean' ? opts.ignoreBots : true;
        this.ignoreSelf = typeof opts.ignoreSelf === 'boolean' ? opts.ignoreSelf : true;
        if (this.ignoreSelf) {
            this.use(ignoreSelfMiddleware());
        }
        if (this.ignoreBots) {
            this.use(ignoreBotsMiddleware());
        }

        if (opts.middleware) {
            if (opts.middleware.send) {
                this.middleware.send.use(opts.middleware.send);
            }
            if (opts.middleware.receive) {
                this.middleware.receive.use(opts.middleware.receive);
            }
        }

        const webhookPath = options.webhook || process.env.WEBHOOK_PATH || '/';
        this.webhook = webhookPath.charAt(0) !== '/' ? `/${webhookPath}` : webhookPath;

        /**
         * Cached conversations, keyed by conversation ID.
         * @name ChipChat#_conversations
         * @type {object}
         */
        this._conversations = {};

        /**
         * Cached organizations, keyed by organization ID.
         * @name ChipChat#_organizations
         * @type {object}
         */
        this._organizations = {};
        //this._orgMap = {};

        this._registeredCallbacks = {};
        this._textRegexpCallbacks = [];
        this._replyListenerId = 0;
        this._replyListeners = [];

        this.on('error', (e) => {
            debug('error', e.message || e);
        });
        this.on('conversation.update', (event) => {
            if (this._conversations[event.data.conversation.id]) {
                this._conversations[event.data.conversation.id] = event.data.conversation;
            }
        });

        this._initApi();
    }

    /**
     * Apply `receive` middleware on all incoming message webhooks.
     * @param  {function|array} middleware function(s)
     * @return instance
     */
    use(...args) {
        this.middleware.receive.use(...args);
        return this;
    }

    /**
     * Enable a module for the bot instance. Modules are simply functions
     * that you can use to organize your code in different files and folders.
     *
     * @param {Function} factory Called immediatly and receives the bot
     * instance as its only parameter.
     * @param {Object} Options object to pass options to the module
    */
     module(factory, opts = {}) {
         return factory.apply(this, [this, opts]);
     }

    /**
     * Register a callback by name, to have it referenced later by name-based callback
     * (eg on ask())
     *
     * @param  {String}   name
     * @param  {Function} callback
     */
    registerCallback(name, callback) {
        this._registeredCallbacks[name] = callback;
    }

    /**
     * Listen for [ChatShipper webhooks](https://developers.chatshipper.com/docs/pg-webhooks/),
     * which are fired for almost every significant action that users take on
     * ChatShipper. This registers a handler function to be called whenever this event is fired.
     *
     * @param {string|array} event - the name of the [ChatShipper webhook
     * event](https://developers.chatshipper.com/docs/pg-webhooks/#section-8-2-webhook-events).
     * @param {object} [conditionals] - Matching conditions key-value pairs
     * @param {function(Object)} handler - The handler to call.
     */
    on(events, conditionals, callback) {
        debug('on.event', events);
        if (!Array.isArray(events)) {
            events = [events];
        }
        //if (event === 'message') { event = 'message.**'; }
        if (!callback) {
            events.forEach(
                event => super.on(event, conditionals)
            );
            return this;
        }
        events.forEach(
            event => super.on(event, (m, c) => {
                if (match(c, m, conditionals)) {
                    debug('matched cond');
                    callback(m, c);
                }
            })
        );
        return this;
    }

    /**
     * Register a RegExp to test against an incomming text message.
     * @param  {RegExp}   regexp       RegExp to be executed with `exec`.
     * @param  {Function} callback     Callback will be called with 2 parameters,
     * the `msg` and the result of executing `regexp.exec` on message text.
     */
    onText(triggers, conditionals, callbackProto) {
        if (!Array.isArray(triggers)) {
            triggers = [triggers];
        }
        let callback = conditionals;
        if (callbackProto) {
            callback = (m, c) => {
                if (match(c, m, conditionals)) {
                    debug('matched cond onText');
                    callbackProto(m, c);
                }
            };
        }
        triggers
            //.map(text => (text instanceof RegExp ? text : new RegExp(text, 'i')))
            .forEach(
                regexp => this._textRegexpCallbacks.push({ regexp, callback })
            );
        return this;
    }

    /**
     * Remove a listener registered with `onText()`.
     * @param  {RegExp} regexp RegExp used previously in `onText()`
     * @return {Object} deletedListener The removed reply listener if
     *   found. This object has `regexp` and `callback`
     *   properties. If not found, returns `null`.
     */
    removeTextListener(regexp) {
        const index = this._textRegexpCallbacks.findIndex((textListener) => {
            return textListener.regexp === regexp;
        });
        if (index === -1) {
            return null;
        }
        return this._textRegexpCallbacks.splice(index, 1)[0];
    }

    /**
     * Register a reply to wait for a message response.
     * @param  {Number|String}   chatId       The chat id where the message cames from.
     * @param  {Number|String}   messageId    The message id to be replied.
     * @param  {Function} callback     Callback will be called with the reply
     *  message.
     * @return {Number} id                    The ID of the inserted reply listener.
     */
    onReply(chatId, messageId, callback) {
        const id = ++this._replyListenerId; // eslint-disable-line no-plusplus
        debug('add reply listener', id, chatId, messageId);
        this._replyListeners.push({
            id,
            chatId,
            messageId,
            callback
        });
        return id;
    }

    /**
     * Removes a reply that has been prev. registered for a message response.
     * @param   {Number} replyListenerId      The ID of the reply listener.
     * @return  {Object} deletedListener      The removed reply listener if
     *   found. This object has `id`, `chatId`, `messageId` and `callback`
     *   properties. If not found, returns `null`.
     */
    removeReplyListener(replyListenerId) {
        const index = this._replyListeners.findIndex((replyListener) => {
            return replyListener.id === replyListenerId;
        });
        debug('removeReplyListener', index);
        if (index === -1) {
            return null;
        }
        return this._replyListeners.splice(index, 1)[0];
    }

    /**
     * Ingest raw webhook data
     * @param  {Object} payload - the full webhook payload
     * @param  {String} [signature] - x-hub-signature http header, a HMAC to verify the payload
     */
    ingest(payload, signature) {
        if (signature) {
            const calculated = getSignature(JSON.stringify(payload), this.secret);
            if (calculated !== signature) {
                this.emit('error', { type: 'ingest', message: 'Message integrity check failed' });
                return;
            }
        }
        if (!payload || !payload.event) {
            this.emit('error', { type: 'ingest', message: 'Invalid payload, missing event' });
            return;
        }
        debug('ingest %s event', payload.event, Object.keys(payload).join(','));

        // message.create.** event
        if (payload.event.startsWith('message')) {
            if (!payload.data || !payload.data.conversation || !payload.data.conversation.id) {
                this.emit('error', { type: 'ingest', message: 'Invalid payload, missing conversation' });
                return;
            }
            // Set the conversation for this request, to later build the chat object from
            this._conversations[payload.data.conversation.id] = payload.data.conversation;

            let isHandled = false;
            // Preload organization if configured
            if (!this._organizations[payload.data.conversation.organization]
                && this.preloadOrganizations
            ) {
                this.organizations
                    .get(payload.data.conversation.organization, { populate: 'categories.forms' })
                    .then((org) => {
                        debug('cachedorg', org.id);
                        this._organizations[org.id] = org;
                        //payload.data.conversation.organization = org;
                        this._handleEvent(payload.event, payload);
                    })
                    .catch((err) => {
                        debug('error loading organization', err.toString());
                        this.emit('error', { message: `Could not load organization ${payload.data.conversation.organization}: ${err.toString()}` });
                    });
                isHandled = true;
            }
            if (!isHandled) {
                this._handleEvent(payload.event, payload);
            }

        // <resource>.<action> event
        } else if (payload.activity) {
            this._handleEvent(payload.event, payload);

        // invalid payload
        } else {
            debug('unknown event, payload keys:', Object.keys(payload));
        }
    }

    /**
       @private
     */
    _handleEvent(type, event) {
        // debug('_handleEvent', type, event.message ? event.message.text : event.text);
        this.middleware.receive.run([this, event], (err) => {
            if (err) {
                this.emit('error', { type: 'middleware', message: `middleware receive processing error:  ${err}` });
                return;
            }
            debug('emit activity');
            this.emit('activity', event.activity);
            const isMessage = type.startsWith('message');
            if (isMessage && event.data && event.data.message) {
                this._handleMessage(type, event.data.message);
            } else {
                debug('emit', type);
                this.emit(type, event);
            }
        });
    }

    /**
       @private
     */
    _handleMessage(type, message) {
        const ctx = this._getActionsObject(message.conversation);
        //debug('handleMessage', ctx.id);

        let hasReplied = false;
        if (type !== 'channel.notify'
            && (message.type === 'chat' || message.type === 'postback')
            && message.text
            && (message.role === 'contact' || message.role === 'agent')
        ) {
            this._textRegexpCallbacks.some(({ regexp, callback }) => {
                debug('matching %s with %s', message.text, regexp);
                const result = regexp instanceof RegExp
                    ? regexp.exec(message.text)
                    : message.text.toUpperCase() === regexp.toUpperCase();
                if (!result) {
                    return false;
                }
                // reset index so we start at the beginning of the regex each time
                if (regexp instanceof RegExp) {
                    regexp.lastIndex = 0;
                }
                debug('matches %s', regexp);
                // let other handlers know it's been caught before
                ctx.captured = true;
                callback(message, ctx);
                // returning truthy value exits .some
                return this.onlyFirstMatch;
            });

            const questionAsked = ctx.get(`_asked${this.auth.user}`);
            debug('questionAsked', questionAsked, this._replyListeners.length);
            if (questionAsked) {
                // Only callbacks waiting for this message
                this._replyListeners.forEach((reply) => {
                    debug('checklistener', reply.chatId, message.conversation);
                    // Message from the same chat
                    if (reply.chatId === message.conversation) {
                        // Responding to that message
                        //if (reply.messageId === questionAsked) {
                        // Resolve the promise
                        let callback = reply.callback;
                        if (typeof reply.callback === 'string') {
                            callback = this._registeredCallbacks[reply.callback];
                        }
                        callback(message);
                        hasReplied = true;
                        //}
                    }
                });
            }
        }
        if (!hasReplied) {
            debug('emit message+type', type);
            this.emit('message', message, ctx);
            this.emit(type, message, ctx);
            if (message.type === 'command' && message.text === '/assign' && message.meta.users.indexOf(this.auth.user) !== -1) {
                debug('emit notify /assign');
                this.emit('notify', message, ctx);
            }
            if (message.type === 'command' && /^>/.test(message.text)) {
                debug('emit notify botcmd', message.text);
                this.emit('notify', message, ctx);
            }
            if (message.type === 'mention'
                && message.meta && message.meta.targetUser === this.auth.user) {
                debug('emit notify mention');
                this.emit('notify', message, ctx);
            }
            if (type.startsWith('message') && message.role) {
                debug(`emit ${type}.${message.role}`);
                this.emit(`${type}.${message.role}`, message, ctx);
            }
        }
    }

    /**
     * Load a conversation object, augmented with context methods
     * @param  {String|Object}   connversationId or connversation
     * @param  {[Function]} callback
     * @return {[Promise]}
     */
    conversation(conversation, cb) {
        if (!conversation) { // || this._conversations[conversation]) {
            this.emit('error', { message: `missing conversation ${conversation}` });
            const err = new Error(`missing conversation ${conversation}`);
            return cb ? cb(err) : Promise.reject(err);
        }
        const finish = (conv) => {
            this._conversations[conv.id] = conv;
            const ctx = this._getActionsObject(conv.id);
            if (!cb) return Promise.resolve(ctx);
            setTimeout(() => { cb(null, ctx); }, 0); // next tick
            return null;
        };
        if (typeof conversation !== 'string' && conversation.id) {
            return finish(conversation);
        }
        return this.conversations.get(conversation).then(finish);
    }

    /**
       Gets the Actions object that wraps the possible responses of an incomming message or event
       @private
     */
    _getActionsObject(convId) {
        if (!convId || !this._conversations[convId]) {
            this.emit('error', { message: `missing conv ${convId}` });
            return {};
        }

        const command = (text, meta = {}) => this.send(
            convId,
            { text, type: 'command', user: this.uid, meta }
        );
        const metaAssign = (users) => {
            if (!users) return {};
            if (!users.length) return {};
            return {
                meta: {
                    users: Array.isArray(users) ? users : [users]
                }
            };
        };
        const metaNotify = (channels, organizations) => {
            if (!channels && !organizations) return {};
            if (!channels.length && !organizations.length) return {};
            const arrVal = (param) => {
                if (!param || !param.length) return null;
                if (Array.isArray(param)) {
                    return param.length ? param : null;
                }
                return [param];
            };
            return {
                meta: {
                    channels: arrVal(channels),
                    organizations: arrVal(organizations)
                }
            };
        };
        return Object.assign({}, this._conversations[convId] || {}, {
            organization: this._organizations[this._conversations[convId]]
                || (this._conversations[convId] || {}).organization,
            say: this.send.bind(this, convId),
            accept: () => command('/accept'),
            join: () => command('/join'),
            leave: () => command('/leave'),
            assign: users => command('/assign', metaAssign(users)),
            notify: (channels, orgs) => command('/notify', metaNotify(channels, orgs)),
            set: (key, val) => {
                const matches = key.match(/^@(.*)$/);
                const conversation = this._conversations[convId] || {};
                if (matches && conversation[matches[1]]) {
                    conversation[matches[1]] = val;
                } else {
                    ((this._conversations[convId] || {}).meta || {})[key] = val;
                }
                return command(`/set ${key} ${val}`);
            },
            get: (key) => {
                const matches = key.match(/^@(.*)$/);
                const conversation = this._conversations[convId] || {};
                return matches && conversation[matches[1]] !== undefined
                    ? conversation[matches[1]]
                    : (conversation.meta || {})[key];
            },
            ask: (q, cb) => {
                this.send(convId, q, (e, msg) => {
                    if (e) { return this.emit('error', e); }
                    command(`/set _asked${this.auth.user} ${msg.id}`);
                    const id = this.onReply(convId, msg.id, (m) => {
                        debug('ask.answered', m.text);
                        this.removeReplyListener(id);
                        const c = this._getActionsObject(convId);
                        if (cb && typeof cb === 'string') {
                            this._registeredCallbacks[cb](m, c);
                        } else {
                            cb(m, c);
                        }
                    });
                    return id;
                });
            }
        });
    }
}

module.exports = ChipChat;
