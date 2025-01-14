const assert = require('assert');
const mock = require('mock-require');
const sinon = require('sinon');

//multi file reset
sinon.restore();
mock.stopAll();

// no real world requests, we replace request-promise that chipchat uses for a stub
const request = sinon.stub();
mock('request-promise', request);

const Bot = require('../lib/chipchat');

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI1YjExMGRhZWU3MGJhYTQ4NWIxYjE2YmEiLCJvcmdhbml6YXRpb24iOiI1OTc4YmY0YjAyOTY0MDRlNmY5OTQ3ZTUiLCJzY29wZSI6InZpZXdlciBndWVzdCBhZ2VudCBib3QgYWRtaW4iLCJpYXQiOjE1NjQ1NjkzMDMsImV4cCI6MTU2NDY1NTcwM30.2q6isPDL5uMwtnyThVGN8Hq9UMqhzAkf72mZdVrSFgc';
const USER = '5b110daee70baa485b1b16ba';

const METHODS = ['create', 'delete', 'get', 'list', 'update'];
const RESOURCES = [
    'users', 'channels', //'usergroups',
    'contacts', 'conversations', 'messages',
    'organizations', 'orggroups', 'services', 'forms',
    'workflows', 'metrics',
    'kbases', 'kbitems', 'articles', 'files'
];
const equal = assert.deepStrictEqual;

describe('Client tests', () => {
    describe('A bot should have all the resources', () => {
        RESOURCES.forEach((resource) => {
            it(`${resource} has all its methods`, () => {
                const bot = new Bot();
                equal(Object.keys(bot[resource]).sort(), METHODS);
            });
        });
    });
    describe('Requesting recource endpoints', () => {
        it('A bot\'s resource should return a promise when no callback is passed', () => {
            const bot = new Bot({ token: TOKEN });
            request.resetHistory();
            request.resolves(true);
            bot.users.get('123456').then(() => {
                equal(request.calledOnce, true);
            }).catch((e) => {
                equal(true, false, `should not have error ${e}`);
            });
        });
        it('A bot\'s resource should not return a promise when a callback is passed', () => {
            const bot = new Bot({ token: TOKEN });
            request.resetHistory();
            request.resolves(true);
            bot.users.get('123456', () => {
                equal(request.calledOnce, true);
            }).then(() => {
                // no promise is return when using a callback
                equal(true, false, 'should not return a promise');
            }).catch((e) => {
                if (e.code && e.code !== 'ERR_ASSERTION') equal(true, false, `should not have error ${e.message}`);
            });
        });
    });
    describe('Using send to add a message to a conversation', () => {
        it('A promise is return when not using a callback', () => {
            const bot = new Bot({ token: TOKEN });
            request.resetHistory();
            request.resolves(true);
            const payload = {};
            bot.send('convid', payload).then(() => {
                equal(request.calledOnce, true);
            }).catch((e) => {
                equal(true, false, `should not have error ${e}`);
            });
        });
        it('No promise is return when using a callback', () => {
            const bot = new Bot({ token: TOKEN });
            request.resetHistory();
            request.resolves(true);
            const payload = {};
            bot.send('convid', payload, () => {
                equal(request.calledOnce, true);
            }).then(() => {
                // no promise is return when using a callback
                equal(true, false, 'should not return a promise');
            }).catch((e) => {
                if (e.code && e.code !== 'ERR_ASSERTION') equal(true, false, `should not have error ${e.message}`);
            });
        });
        it('You can send a text direcly', () => {
            const bot = new Bot({ token: TOKEN });
            request.resetHistory();
            request.resolvesArg(0);
            bot.send('convid', 'hi there').then((usedPayload) => {
                equal(request.calledOnce, true);
                equal(usedPayload.body.text, 'hi there');
            });
        });
        it('You can send a text direcly', () => {
            const bot = new Bot({ token: TOKEN });
            request.resetHistory();
            request.resolvesArg(0);
            bot.send('convid', 'hi there').then((usedPayload) => {
                equal(request.calledOnce, true);
                equal(usedPayload.body.text, 'hi there');
            });
        });
        it('You can use say to a text direcly', async () => {
            const bot = new Bot({ token: TOKEN, ignoreSelf: false });
            const payload = { event: 'message.create.contact.chat', data: { conversation: { id: 123456, organization: 12345 }, message: { conversation: 123456, user: USER, text: 'hi' } } };
            request.resetHistory();
            request.resolvesArg(0);
            bot.on('message', async (m, c) => {
                equal(m.text, 'hi');
                const usedPayload = await c.say('hi there bot');
                equal(usedPayload.body.text, 'hi there bot');
                equal(request.callCount, 1);
            });
            await bot.ingest(payload);
        });
    });
});
