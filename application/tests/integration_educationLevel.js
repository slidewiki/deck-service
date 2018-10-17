/* eslint-env mocha */
'use strict';

const chai = require('chai');
chai.should();

describe.only('REST API deck education level', () => {

    const _ = require('lodash');
    const qs = require('querystring');

    const util = require('../lib/util');
    const testServer = require('../testServer');
    const authToken = testServer.tokenFor(1);

    let server;
    before(async () => {
        server = await testServer.init();
        return server.start();
    });

    after(async () => {
        return server && server.stop();
    });

    it('should fail to create a deck with invalid educationLevel', async() => {
        let response = await server.inject({
            method: 'POST',
            url: '/deck/new',
            payload: {
                title: 'The root for education level tests',
                educationLevel: '0111',
            },
            headers: {
                '----jwt----': authToken,
            },
        });
        response.should.have.property('statusCode', 400);
    });

    context('when creating a new deck with educationLevel "0"', () => {
        let deckId, otherDeckId;

        before(async() => {
            // create a deck
            let response = await server.inject({
                method: 'POST',
                url: '/deck/new',
                payload: {
                    title: 'The root for education level tests',
                    educationLevel: '0',
                },
                headers: {
                    '----jwt----': authToken,
                },
            });

            response.should.have.property('statusCode', 200);
            deckId = response.result.id;

            // create another deck to attach later on
            response = await server.inject({
                method: 'POST',
                url: '/deck/new',
                payload: {
                    title: 'A deck to attach',
                    educationLevel: '2',
                },
                headers: {
                    '----jwt----': authToken,
                },
            });
            response.should.have.property('statusCode', 200);
            otherDeckId = response.result.id;
        });

        it('the deck educationLevel should be "0"', async () => {
            // read the deck
            let response = await server.inject({
                method: 'GET',
                url: `/deck/${deckId}`,
            });
            response.should.have.property('statusCode', 200);
            response.result.should.have.nested.property('revisions.0.educationLevel', '0');
        });

        it('the deck educationLevel should be updateable to "1"', async () => {
            // read the deck
            let response = await server.inject({
                method: 'PUT',
                url: `/deck/${deckId}`,
                payload: {
                    top_root_deck: String(deckId),
                    title: 'The root for education level tests',
                    license: 'CC BY-SA',
                    educationLevel: '1',
                },
                headers: {
                    '----jwt----': authToken,
                },
            });
            response.should.have.property('statusCode', 200);
            response.result.should.have.nested.property('revisions.0.educationLevel', '1');

            // read the change in history
            response = await server.inject({
                method: 'GET',
                url: `/deck/${deckId}/changes`,
            });
            response.should.have.property('statusCode', 200);
            response.result.should.have.nested.property('0.values.educationLevel', '1');
            response.result.should.have.nested.property('0.oldValues.educationLevel', '0');
        });

        it('the deck educationLevel should not be updateable to an invalid value', async () => {
            // read the deck
            let response = await server.inject({
                method: 'PUT',
                url: `/deck/${deckId}`,
                payload: {
                    top_root_deck: String(deckId),
                    title: 'The root for education level tests',
                    license: 'CC BY-SA',
                    educationLevel: 1,
                },
                headers: {
                    '----jwt----': authToken,
                },
            });
            response.should.have.property('statusCode', 400);
        });

        it('the deck educationLevel should be "1" for a new revision of the deck', async () => {
            let response = await server.inject({
                method: 'POST',
                url: `/deck/${deckId}/revision`,
                payload: {
                    top_root_deck: String(deckId),
                },
                headers: {
                    '----jwt----': authToken,
                },
            });
            response.should.have.property('statusCode', 200);

            // re-read the deck
            response = await server.inject({
                method: 'GET',
                url: `/deck/${deckId}-2`,
            });
            response.should.have.property('statusCode', 200);
            response.result.should.have.nested.property('revisions.0.educationLevel', '1');
        });

        it('any fork of the deck should also have educationLevel "1"', async () => {
            let response = await server.inject({
                method: 'PUT',
                url: `/deck/${deckId}/fork`,
                headers: {
                    '----jwt----': authToken,
                },
            });
            response.should.have.property('statusCode', 200);
            let forkId = response.result.root_deck;

            // read the fork
            response = await server.inject({
                method: 'GET',
                url: `/deck/${forkId}`,
            });
            response.should.have.property('statusCode', 200);
            response.result.should.have.nested.property('revisions.0.educationLevel', '1');
        });

        it('any subdeck of the deck should also have educationLevel "1" by default', async () => {
            let response = await server.inject({
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
                    '----jwt----': authToken,
                },
            });
            response.should.have.property('statusCode', 200);
            let subdeckId = response.result.id;

            // re-read the deck
            response = await server.inject({
                method: 'GET',
                url: `/deck/${subdeckId}`,
            });
            response.should.have.property('statusCode', 200);
            response.result.should.have.nested.property('revisions.0.educationLevel', '1');
        });

        it('any subdeck of the deck should have another educationLevel (e.g. "3") when provided in payload', async () => {
            let response = await server.inject({
                method: 'POST',
                url: '/decktree/node/create',
                payload: {
                    selector: {
                        id: String(deckId),
                    },
                    nodeSpec: {
                        type: 'deck',
                        deck: {
                            educationLevel: '3',
                        }
                    },
                },
                headers: {
                    '----jwt----': authToken,
                },
            });
            response.should.have.property('statusCode', 200);
            let subdeckId = response.result.id;

            // re-read the deck
            response = await server.inject({
                method: 'GET',
                url: `/deck/${subdeckId}`,
            });
            response.should.have.property('statusCode', 200);
            response.result.should.have.nested.property('revisions.0.educationLevel', '3');
        });

        it('a subdeck should not be allowed to inserted if an invalid educationLevel is provided in payload', async () => {
            let response = await server.inject({
                method: 'POST',
                url: '/decktree/node/create',
                payload: {
                    selector: {
                        id: String(deckId),
                    },
                    nodeSpec: {
                        type: 'deck',
                        deck: {
                            educationLevel: '3a',
                        }
                    },
                },
                headers: {
                    '----jwt----': authToken,
                },
            });
            response.should.have.property('statusCode', 400);
        });

        it('a deck of educationLevel "2" should still have the same value after it\'s attached', async() => {
            let response = await server.inject({
                method: 'POST',
                url: '/decktree/node/create',
                payload: {
                    selector: {
                        id: String(deckId),
                    },
                    nodeSpec: {
                        type: 'deck',
                        id: String(otherDeckId),
                    },
                },
                headers: {
                    '----jwt----': authToken,
                },
            });
            response.should.have.property('statusCode', 200);
            let attachedDeckId = response.result.id;
            // re-read the deck
            response = await server.inject({
                method: 'GET',
                url: `/deck/${attachedDeckId}`,
            });
            response.should.have.property('statusCode', 200);
            response.result.should.have.nested.property('revisions.0.educationLevel', '2');
        });

    });

});
