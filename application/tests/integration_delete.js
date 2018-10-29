/* eslint-env mocha */
'use strict';

const chai = require('chai');
chai.should();

const mockery = require('mockery');

describe('REST API deck delete', () => {

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

    context('for a simple deck without subdecks', () => {
        let deckId, slideId;

        before(async() => {
            // create a deck to delete later
            let response = await server.inject({
                method: 'POST',
                url: '/deck/new',
                payload: {
                    title: 'The root for delete deck tests',
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

            response = await server.inject({
                method: 'GET',
                url: `/decktree/${deckId}`,
            });

            slideId = response.result.children[0].id;

        });

        it('a deck editor should not be allowed to delete the deck', async () => {
            let response = await server.inject({
                method: 'DELETE',
                url: `/deck/${deckId}`,
                headers: {
                    '----jwt----': tokenFor(editorId),
                },
            });
            response.should.have.property('statusCode', 403);
        });

        it('a user without edit rights should not be allowed to delete the deck', async () => {
            let response = await server.inject({
                method: 'DELETE',
                url: `/deck/${deckId}`,
                headers: {
                    '----jwt----': tokenFor(someUserId),
                },
            });
            response.should.have.property('statusCode', 403);
        });

        it('a guest should not be allowed to delete the deck', async () => {
            let response = await server.inject({
                method: 'DELETE',
                url: `/deck/${deckId}`,
            });
            response.should.have.property('statusCode', 401);
        });

        it('the deck owner should be allowed to delete the deck', async () => {
            let response = await server.inject({
                method: 'DELETE',
                url: `/deck/${deckId}`,
                headers: {
                    '----jwt----': tokenFor(ownerId),
                },
            });
            response.should.have.property('statusCode', 200);
        });

        it('the deck should be inaccessible after it\'s been deleted', async () => {
            // getters
            let response = await server.inject({
                method: 'GET',
                url: `/deck/${deckId}`,
            });
            response.should.have.property('statusCode', 404);

            response = await server.inject({
                method: 'GET',
                url: `/deck/${deckId}/slides`,
            });
            response.should.have.property('statusCode', 404);

            response = await server.inject({
                method: 'GET',
                url: `/deck/${deckId}/permissions`,
                headers: {
                    '----jwt----': tokenFor(ownerId),
                },
            });
            response.should.have.property('statusCode', 404);

            response = await server.inject({
                method: 'GET',
                url: `/decktree/${deckId}`,
            });
            response.should.have.property('statusCode', 404);

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
            response.should.have.property('result').that.is.an('array');
            response.result.every((i) => i._id !== deckId).should.be.true;

            response = await server.inject({
                method: 'GET',
                url: '/allrecent/10/0',
            });
            response.should.have.property('statusCode', 200);
            response.should.have.property('result').that.is.an('array');
            response.result.every((i) => i._id !== deckId).should.be.true;
        });

        it('the deck should not be included in user private deck lists', async () => {
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

    context('for a deck with a subdeck', () => {
        let deckId, subdeckId, slideId, subdeckSlideId;

        before(async() => {
            // create a deck to delete later
            let response = await server.inject({
                method: 'POST',
                url: '/deck/new',
                payload: {
                    title: 'The root for delete deck tests',
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

        it('the deck owner should not be allowed to delete the deck', async () => {
            let response = await server.inject({
                method: 'DELETE',
                url: `/deck/${deckId}`,
                headers: {
                    '----jwt----': tokenFor(ownerId),
                },
            });
            response.should.have.property('statusCode', 405);
        });

        it('the deck owner should not be allowed to delete the subdeck', async () => {
            let response = await server.inject({
                method: 'DELETE',
                url: `/deck/${parseInt(subdeckId)}`,
                headers: {
                    '----jwt----': tokenFor(ownerId),
                },
            });
            response.should.have.property('statusCode', 405);
        });

        context('after removing the subdeck', () => {

            before(async () => {
                let response = await server.inject({
                    method: 'DELETE',
                    url: '/decktree/node/delete',
                    payload: {
                        selector: {
                            id: String(deckId),
                            sid: String(subdeckId),
                            stype: 'deck',
                        },
                    },
                    headers: {
                        '----jwt----': tokenFor(ownerId),
                    },
                });
                response.should.have.property('statusCode', 200);
            });

            it('the deck owner should be allowed to delete the deck', async () => {
                let response = await server.inject({
                    method: 'DELETE',
                    url: `/deck/${deckId}`,
                    headers: {
                        '----jwt----': tokenFor(ownerId),
                    },
                });
                response.should.have.property('statusCode', 200);
            });

            it('the deck owner should be allowed to delete the subdeck', async () => {
                let response = await server.inject({
                    method: 'DELETE',
                    url: `/deck/${parseInt(subdeckId)}`,
                    headers: {
                        '----jwt----': tokenFor(ownerId),
                    },
                });
                response.should.have.property('statusCode', 200);
            });

        });

    });

});
