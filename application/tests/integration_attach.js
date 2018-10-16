/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

const chai = require('chai');
chai.should();

describe('REST API attach', () => {

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

    context('when creating a new deck with a translation', () => {
        let deckId;

        before(async () => {
            let response = await server.inject({
                method: 'POST',
                url: '/deck/new',
                payload: {
                    title: 'The root for usage tests',
                    language: 'en',
                    hidden: false,
                },
                headers: {
                    '----jwt----': authToken,
                },
            });
            if (response.statusCode !== 200) {
                throw new Error(`could not create deck:\n\t${response.payload}`);
            }
            deckId = JSON.parse(response.payload).id;

            response = await server.inject({
                method: 'POST',
                url: `/deck/${deckId}/translations`,
                payload: {
                    language: 'fr',
                },
                headers: {
                    '----jwt----': authToken,
                },
            });
            if (response.statusCode !== 200) {
                throw new Error(`could not create deck translation:\n\t${response.payload}`);
            }

            response = await server.inject({
                method: 'POST',
                url: `/deck/${deckId}/translations`,
                payload: {
                    language: 'el',
                },
                headers: {
                    '----jwt----': authToken,
                },
            });
            if (response.statusCode !== 200) {
                throw new Error(`could not create deck translation:\n\t${response.payload}`);
            }

        });

        context('and we attach some other deck to the deck', () => {
            let otherDeckId, attachedDeckId;
            before(async () => {
                let response = await server.inject({
                    method: 'POST',
                    url: '/deck/new',
                    payload: {
                        title: 'Un deck',
                        language: 'fr',
                    },
                    headers: {
                        '----jwt----': authToken,
                    },
                });
                if (response.statusCode !== 200) {
                    throw new Error(`could not create the other deck:\n\t${response.payload}`);
                }
                otherDeckId = JSON.parse(response.payload).id;

                response = await server.inject({
                    method: 'POST',
                    url: `/deck/${otherDeckId}/translations`,
                    payload: {
                        language: 'de',
                    },
                    headers: {
                        '----jwt----': authToken,
                    },
                });
                if (response.statusCode !== 200) {
                    throw new Error(`could not create deck translation:\n\t${response.payload}`);
                }

                // add another slide there
                response = await server.inject({
                    method: 'POST',
                    url: '/decktree/node/create',
                    payload: {
                        selector: {
                            id: String(otherDeckId),
                            spath: '',
                        },
                        nodeSpec: {
                            type: 'slide',
                        },
                    },
                    headers: {
                        '----jwt----': authToken,
                    },
                });
                if (response.statusCode !== 200) {
                    throw new Error(`could not create the other deck:\n\t${response.payload}`);
                }

                // attach the deck
                response = await server.inject({
                    method: 'POST',
                    url: '/decktree/node/create',
                    payload: {
                        selector: {
                            id: String(deckId),
                            spath: '',
                        },
                        nodeSpec: {
                            id: String(otherDeckId),
                            type: 'deck',
                        },
                    },
                    headers: {
                        '----jwt----': authToken,
                    },
                });
                if (response.statusCode !== 200) {
                    throw new Error(`could not attach the deck:\n\t${response.payload}`);
                }
                attachedDeckId = JSON.parse(response.payload).id;
            });

            it('the parent deck tree should include the attached deck languages as translations', async () => {
                // read the parent deck tree
                let response = await server.inject({
                    method: 'GET',
                    url: `/decktree/${deckId}`,
                });
                response.should.have.property('statusCode', 200);

                response.result.should.have.property('variants').that.includes.deep.members([
                    { language: 'fr' },
                    { language: 'de' },
                ]);

            });

            context('and we attach directly two slides from some deck with a language not in deck translations', () => {
                let attachedSlideIds, otherSlides;
                before(async () => {
                    // create a deck in some language
                    let response = await server.inject({
                        method: 'POST',
                        url: '/deck/new',
                        payload: {
                            title: 'Una deca',
                            language: 'es',
                        },
                        headers: {
                            '----jwt----': authToken,
                        },
                    });
                    response.should.have.property('statusCode', 200);
                    let spanishDeckId = response.result.id;

                    // add another slide there
                    response = await server.inject({
                        method: 'POST',
                        url: '/decktree/node/create',
                        payload: {
                            selector: {
                                id: String(spanishDeckId),
                                spath: '',
                            },
                            nodeSpec: {
                                type: 'slide',
                            },
                        },
                        headers: {
                            '----jwt----': authToken,
                        },
                    });
                    response.should.have.property('statusCode', 200);

                    // and get the slide refs
                    response = await server.inject(`/deck/${spanishDeckId}`);
                    response.should.have.property('statusCode', 200);

                    otherSlides = response.result.contentItems.map((i) => i.ref);

                    response = await server.inject({
                        method: 'POST',
                        url: '/decktree/node/create',
                        payload: {
                            selector: {
                                id: String(deckId),
                                spath: '',
                            },
                            nodeSpec: otherSlides.map((slide) => ({
                                id: `${slide.id}-${slide.revision}`,
                                type: 'slide',
                                root: String(spanishDeckId),
                            })),
                        },
                        headers: {
                            '----jwt----': authToken,
                        },
                    });
                    response.should.have.property('statusCode', 200);

                    attachedSlideIds = response.result.map((e) => e.id);
                });

                it('the deck tree should also include the new language in its translations', async () => {
                    let response = await server.inject(`/decktree/${deckId}`);
                    response.statusCode.should.equal(200);

                    response.result.should.have.property('variants').that.includes.deep.members([
                        { language: 'es' },
                    ]);

                });

            });

        });

    });

});
