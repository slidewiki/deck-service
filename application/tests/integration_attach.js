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
                    language: 'en-GB',
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
                    language: 'fr-FR',
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
                    language: 'el-GR',
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
            let otherDeckId, otherSlides, attachedDeckId;
            before(async () => {
                let response = await server.inject({
                    method: 'POST',
                    url: '/deck/new',
                    payload: {
                        title: 'Un deck',
                        language: 'fr-FR',
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
                        language: 'de-DE',
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

                // and get the slide refs
                response = await server.inject({
                    method: 'GET',
                    url: '/deck/' + otherDeckId,
                });
                if (response.statusCode !== 200) {
                    throw new Error(`could not get the other deck:\n\t${response.payload}`);
                }
                otherSlides = JSON.parse(response.payload).revisions[0].contentItems.map((i) => i.ref);

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

            it('the parent should have the attached deck language as one of its translations', async () => {
                // read the parent translations
                let response = await server.inject({
                    method: 'GET',
                    url: `/deck/${deckId}/translations`,
                });
                response.should.have.property('statusCode', 200);

                response.result.should.have.deep.members([
                    { language: 'el-GR' },
                    { language: 'fr-FR' },
                ]);

                // read the attached language
                response = await server.inject({
                    method: 'GET',
                    url: `/deck/${attachedDeckId}`,
                });
                response.should.have.property('statusCode', 200);
                response.result.should.have.nested.property('revisions.0.language', 'en-GB');
                response.result.should.have.nested.property('revisions.0.title', 'Un deck');

                // read the attached translations
                response = await server.inject({
                    method: 'GET',
                    url: `/deck/${attachedDeckId}/translations`,
                });
                response.should.have.property('statusCode', 200);

                response.result.should.have.deep.members([
                    { language: 'de-DE' },
                    { language: 'el-GR' },
                    { language: 'fr-FR', title: 'Un deck' },
                ]);

            });

            it('the slides of the attached deck should be variant nodes in parent', async() => {
                for (let slide of otherSlides) {
                    let response = await server.inject(`/decktree/node/translations?${qs.stringify({
                        id: deckId,
                        stype: 'slide',
                        sid: `${slide.id}-${slide.revision}`,
                    })}`);
                    response.statusCode.should.equal(200);
                    response.result.should.have.deep.members([
                        { id: slide.id, revision: slide.revision, language: 'fr-FR' }
                    ]);
                }
            });

            it('the slides of the attached deck should have been copied to become primary slides in the parent deck', async() => {
                let response = await server.inject(`/decktree/${attachedDeckId}`);
                response.statusCode.should.equal(200);

                response.result.should.have.property('children').that.is.an('array').of.length(2);

                for (let node of response.result.children) {
                    // fetch the slide data
                    let response = await server.inject(`/slide/${node.id}`);
                    response.statusCode.should.equal(200);
                    response.result.should.have.property('language', 'en-GB');
                    otherSlides.should.deep.include(_.pick(response.result.revisions[0].parent, 'id', 'revision'));
                }

            });

            context('and we attach directly two other slides', () => {
                let attachedSlideIds;
                before(async () => {
                    let response = await server.inject({
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
                                root: String(otherDeckId),
                            })),
                        },
                        headers: {
                            '----jwt----': authToken,
                        },
                    });
                    if (response.statusCode !== 200) {
                        throw new Error(`could not attach the other slides:\n\t${response.payload}`);
                    }
                    attachedSlideIds = response.result.map((e) => e.id);
                });

                it('the slides as they were attached should have the same language as in the parent deck', async () => {
                    for (let slideId of attachedSlideIds) {
                        let response = await server.inject(`/slide/${slideId}`);
                        response.statusCode.should.equal(200);
                        response.result.should.have.property('language', 'en-GB');

                        otherSlides.should.deep.include(_.pick(response.result.revisions[0].parent, 'id', 'revision'));
                    }
                });

                it('the slide nodes of the attached decks should have variants in the origin language that are copies of the original slides', async () => {
                    for (let slideId of attachedSlideIds) {
                        let response = await server.inject(`/decktree/node/translations?${qs.stringify({
                            id: deckId,
                            stype: 'slide',
                            sid: slideId,
                        })}`);
                        response.statusCode.should.equal(200);

                        response.result.should.be.an('array').of.length(1);
                        response.result[0].should.have.property('language', 'fr-FR');
                        
                        response = await server.inject(`/slide/${response.result[0].id}-${response.result[0].revision}`);
                        response.statusCode.should.equal(200);

                        otherSlides.should.deep.include(_.pick(response.result.revisions[0].parent, 'id', 'revision'));
                    }
                });

            });

        });

    });

});
