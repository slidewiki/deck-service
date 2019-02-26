/* eslint-env mocha */
'use strict';

const chai = require('chai');
chai.should();

const mockery = require('mockery');

describe('REST API deck transfer ownership', () => {

    const _ = require('lodash');
    const qs = require('querystring');

    const util = require('../lib/util');

    let server, tokenFor;

    before(() => {
        // first enable mocks
        mockery.enable({
            useCleanCache: true,
            warnOnReplace: false,
            warnOnUnregistered: false,
        });

        // then register user service mock
        mockery.registerMock('../services/user', {
            fetchUserInfo: () => {
                return Promise.reject('not mocking optional function');
            },
            fetchGroupInfo: () => {
                console.log('aaa');
                return Promise.reject('not mocking optional function');
            },
            fetchUsersForGroups: () => {
                return Promise.resolve([]);
            },
            fetchGroupsForUser: () => {
                return Promise.resolve([]);
            },
        });

        // then load libraries
        const testServer = require('../testServer');
        tokenFor = testServer.tokenFor;

        return testServer.init().then((newServer) => {
            server = newServer;
            return server.start();
        });

    });

    after(() => {
        return Promise.resolve().then(() => {
            // disable mocking
            mockery.disable();
            return server && server.stop();
        });
    });

    let ownerId = 1, editorId = 2, someUserId = 3;

    let deckId, slideId, subdeckId, subdeckSlideId;

    before(async() => {
        // create a deck to delete later
        let response = await server.inject({
            method: 'POST',
            url: '/deck/new',
            payload: {
                title: 'The root for tranfer ownership tests',
                hidden: false,
                editors: { users: [2].map((id) =>
                    ({ id, joined: new Date().toISOString() })
                )},
            },
            headers: {
                '----jwt----': tokenFor(ownerId),
            },
        });
        response.should.have.property('statusCode', 200);
        deckId = response.result.id;

        // ...and a subdeck inside that
        response = await server.inject({
            method: 'POST',
            url: '/decktree/node/create',
            payload: {
                selector: {
                    id: String(deckId),
                },
                nodeSpec: {
                    type: 'deck',
                },
            },
            headers: {
                '----jwt----': tokenFor(ownerId),
            },
        });
        response.should.have.property('statusCode', 200);

        response = await server.inject({
            method: 'GET',
            url: `/decktree/${deckId}`,
        });

        slideId = response.result.children[0].id;
        subdeckId = response.result.children[1].id;
        subdeckSlideId = response.result.children[1].children[0].id;
    });

    it('a deck editor should not be allowed to change deck owner', async () => {
        let response = await server.inject({
            method: 'PATCH',
            url: `/deck/${deckId}`,
            payload: {
                user: someUserId,
            },
            headers: {
                '----jwt----': tokenFor(editorId),
            },
        });
        response.should.have.property('statusCode', 403);
    });

    it('a user without edit rights should not be allowed to change deck owner', async () => {
        let response = await server.inject({
            method: 'PATCH',
            url: `/deck/${deckId}`,
            payload: {
                user: someUserId,
            },
            headers: {
                '----jwt----': tokenFor(someUserId),
            },
        });
        response.should.have.property('statusCode', 403);
    });

    it('a guest should not be allowed to change deck owner', async () => {
        let response = await server.inject({
            method: 'PATCH',
            url: `/deck/${deckId}`,
            payload: {
                user: someUserId,
            },
        });
        response.should.have.property('statusCode', 401);
    });

    it('the deck owner should be allowed to transfer deck ownership', async () => {
        let response = await server.inject({
            method: 'PATCH',
            url: `/deck/${deckId}`,
            payload: {
                user: someUserId,
            },
            headers: {
                '----jwt----': tokenFor(ownerId),
            },
        });
        response.should.have.property('statusCode', 200);
    });

    it('the deck should be included in new owner private deck lists', async () => {
        let response = await server.inject({
            method: 'GET',
            url: `/decks?${qs.stringify({status: 'any'})}`,
            headers: {
                '----jwt----': tokenFor(someUserId),
            },
        });
        response.should.have.property('statusCode', 200);

        response.should.have.nested.property('result.items').that.is.an('array');
        response.result.items.some((i) => i._id === deckId).should.be.true;
    });

    it('the deck should not be included in public deck lists', async () => {
        let response = await server.inject({
            method: 'GET',
            url: '/decks',
        });
        response.should.have.property('statusCode', 200);

        response.should.have.nested.property('result.items').that.is.an('array');
        response.result.items.every((i) => i._id !== deckId).should.be.true;

        response = await server.inject({
            method: 'GET',
            url: `/alldecks/${ownerId}`,
        });
        response.should.have.property('statusCode', 200);
        response.should.have.property('result').that.is.empty;

        response = await server.inject({
            method: 'GET',
            url: '/allrecent/10/0',
        });
        response.should.have.property('statusCode', 200);
        response.should.have.property('result').that.is.empty;
    });

    it('the deck should not be included in old owner private deck lists', async () => {
        let response = await server.inject({
            method: 'GET',
            url: `/decks?${qs.stringify({status: 'any'})}`,
            headers: {
                '----jwt----': tokenFor(ownerId),
            },
        });
        response.should.have.property('statusCode', 200);

        response.should.have.nested.property('result.items').that.is.an('array');
        response.result.items.every((i) => i._id !== deckId).should.be.true;
    });

});
