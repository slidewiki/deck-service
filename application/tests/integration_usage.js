/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

const chai = require('chai');
chai.should();

describe('REST API usage', () => {

    const util = require('../lib/util');
    const testServer = require('../testServer');
    const tokenFor = testServer.tokenFor;

    let server;

    before(() => {
        return testServer.init().then((newServer) => {
            server = newServer;
            return server.start();
        });
    });

    after(() => {
        return Promise.resolve().then(() => server && server.stop());
    });

    it('should return 404 when requesting usage of a deck that does not exist', () => {
        return server.inject({
            method: 'GET',
            url: '/deck/999/usage',
        }).then((response) => {
            response.statusCode.should.equal(404);
        });
    });

    it('should return 404 when requesting deep usage of a deck that does not exist', () => {
        return server.inject({
            method: 'GET',
            url: '/deck/999/deepUsage',
        }).then((response) => {
            response.statusCode.should.equal(404);
        });
    });

    it('should return 404 when requesting root decks of a deck that does not exist', () => {
        return server.inject({
            method: 'GET',
            url: '/deck/999/rootDecks',
        }).then((response) => {
            response.statusCode.should.equal(404);
        });
    });

    let authToken = tokenFor(1);
    context('when creating a new deck', () => {
        let deckId, firstSlide;

        before(() => {
            return server.inject({
                method: 'POST',
                url: '/deck/new',
                payload: {
                    title: 'The root for usage tests',
                    theme: 'sky',
                    hidden: false,
                },
                headers: {
                    '----jwt----': authToken,
                },
            }).then((response) => {
                if (response.statusCode !== 200) {
                    throw new Error(`could not create deck:\n\t${response.payload}`);
                }
                deckId = JSON.parse(response.payload).id;

                return server.inject({
                    method: 'GET',
                    url: '/deck/' + deckId,
                }).then((response) => {
                    if (response.statusCode !== 200) {
                        throw new Error(`could not get deck:\n\t${response.payload}`);
                    }
                    firstSlide = JSON.parse(response.payload).revisions[0].contentItems[0].ref;
                });
            });
        });

        it('the deck usage should be empty (DB)', () => {
            return server.inject({
                method: 'GET',
                url: `/deck/${deckId}`,
            }).then((response) => {
                response.statusCode.should.equal(200);

                let payload = JSON.parse(response.payload);
                payload.should.have.nested.property('revisions.0.usage').that.is.an('array').of.length(0);
            });
        });

        it('the deck usage should be empty (API)', () => {
            return server.inject({
                method: 'GET',
                url: `/deck/${deckId}/usage`,
            }).then((response) => {
                response.statusCode.should.equal(200);

                let payload = JSON.parse(response.payload);
                payload.should.be.an('array').of.length(0);
            });
        });

        it('the deck deep usage should be empty', () => {
            return server.inject({
                method: 'GET',
                url: `/deck/${deckId}/deepUsage`,
            }).then((response) => {
                response.statusCode.should.equal(200);

                let payload = JSON.parse(response.payload);
                payload.should.be.an('array').of.length(0);
            });
        });

        it('the deck should have itself as only root deck', () => {
            return server.inject({
                method: 'GET',
                url: `/deck/${deckId}/rootDecks`,
            }).then((response) => {
                response.statusCode.should.equal(200);

                let payload = JSON.parse(response.payload);
                payload.should.be.an('array').of.length(1);
                payload.should.have.deep.members([
                    { id: deckId, hidden: false },
                ]);
            });
        });

        it('the first slide usage should include just the parent deck (DB)', () => {
            return server.inject({
                method: 'GET',
                url: `/slide/${util.toIdentifier(firstSlide)}`,
            }).then((response) => {
                response.statusCode.should.equal(200);

                let payload = JSON.parse(response.payload);
                payload.should.have.nested.property('revisions.0.usage').that.has.deep.members([
                    { id: deckId, revision: 1  },
                ]);
            });
        });

        it('the first slide usage should include just the parent deck (API)', () => {
            return server.inject({
                method: 'GET',
                url: `/slide/${util.toIdentifier(firstSlide)}/usage`,
            }).then((response) => {
                response.statusCode.should.equal(200);

                let payload = JSON.parse(response.payload);
                payload.should.have.deep.members([
                    { id: deckId, revision: 1, theme: 'sky' },
                ]);
            });
        });

        it('the first slide deep usage should include just the parent deck', () => {
            return server.inject({
                method: 'GET',
                url: `/slide/${util.toIdentifier(firstSlide)}/deepUsage`,
            }).then((response) => {
                response.statusCode.should.equal(200);

                let payload = JSON.parse(response.payload);
                payload.should.have.deep.members([
                    { id: deckId, revision: 1, theme: 'sky' },
                ]);
            });
        });

        it('the first slide should have the deck as only root deck', () => {
            return server.inject({
                method: 'GET',
                url: `/slide/${util.toIdentifier(firstSlide)}/rootDecks`,
            }).then((response) => {
                response.statusCode.should.equal(200);

                let payload = JSON.parse(response.payload);
                payload.should.be.an('array').of.length(1);
                payload.should.have.deep.members([
                    { id: deckId, revision: 1, hidden: false },
                ]);
            });
        });

        context('and an additional slide is added', () => {
            let slideId;
            before(() => {
                return server.inject({
                    method: 'POST',
                    url: '/decktree/node/create',
                    payload: {
                        selector: {
                            id: String(deckId),
                            spath: '',
                        },
                        nodeSpec: {
                            type: 'slide',
                        },
                    },
                    headers: {
                        '----jwt----': authToken,
                    },
                }).then((response) => {
                    if (response.statusCode !== 200) {
                        console.error(response.payload);
                        throw new Error(`could not add slide:\n\t${response.payload}`);
                    }
                    slideId = JSON.parse(response.payload).id;
                });
            });

            it('the new slide usage should include the parent deck (DB)', () => {
                return server.inject({
                    method: 'GET',
                    url: `/slide/${slideId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.nested.property('revisions.0.usage').that.has.deep.members([
                        { id: deckId, revision: 1  },
                    ]);
                });
            });

            it('the new slide usage should include the parent deck (API)', () => {
                return server.inject({
                    method: 'GET',
                    url: `/slide/${slideId}/usage`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.deep.members([
                        { id: deckId, revision: 1, theme: 'sky' },
                    ]);
                });
            });

            it('the new slide deep usage should include just the parent deck', () => {
                return server.inject({
                    method: 'GET',
                    url: `/slide/${slideId}/deepUsage`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.deep.members([
                        { id: deckId, revision: 1, theme: 'sky' },
                    ]);
                });
            });

            it('the new slide should have the deck as only root deck', () => {
                return server.inject({
                    method: 'GET',
                    url: `/slide/${slideId}/rootDecks`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.be.an('array').of.length(1);
                    payload.should.have.deep.members([
                        { id: deckId, revision: 1, hidden: false },
                    ]);
                });
            });

            let renamedSlideId;
            context('and that slide is renamed', () => {
                before(() => {
                    return server.inject({
                        method: 'PUT',
                        url: '/decktree/node/rename',
                        payload: {
                            selector: {
                                id: String(deckId),
                                spath: ' ',
                                stype: 'slide',
                                sid: String(slideId),
                            },
                            name: 'another slide name',
                        },
                        headers: {
                            '----jwt----': authToken,
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not rename slide:\n\t${response.payload}`);
                        }
                        let newRevision = JSON.parse(response.payload).revisions[0].id;
                        renamedSlideId = `${parseInt(slideId)}-${newRevision}`;
                    });
                });

                it('the new slide revision should include the parent deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${renamedSlideId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.nested.property('revisions.0.usage').that.has.deep.members([
                            { id: deckId, revision: 1  },
                        ]);
                    });
                });

                it('the new slide revision usage should include the parent deck (API)', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${renamedSlideId}/usage`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.deep.members([
                            { id: deckId, revision: 1, theme: 'sky' },
                        ]);
                    });
                });

                it('the new slide revision deep usage should include just the parent deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${renamedSlideId}/deepUsage`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.deep.members([
                            { id: deckId, revision: 1, theme: 'sky' },
                        ]);
                    });
                });

                it('the new slide revision should have the deck as only root deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${renamedSlideId}/rootDecks`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.be.an('array').of.length(1);
                        payload.should.have.deep.members([
                            { id: deckId, revision: 1, hidden: false },
                        ]);
                    });
                });

                it('the replaced revision of the slide should have empty usage (DB)', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${slideId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.nested.property('revisions.0.usage').that.is.an('array').of.length(0);
                    });
                });

                it('the replaced revision of the slide should have empty usage (API)', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${slideId}/usage`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.be.an('array').of.length(0);
                    });
                });

                it('the replaced revision of the slide should have empty deep usage', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${slideId}/deepUsage`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.be.an('array').of.length(0);
                    });
                });

                it('the replaced revision of the slide should have no root decks', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${slideId}/rootDecks`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.be.an('array').of.length(0);
                    });
                });

            });

        });

        let subdeckId, subsubdeckId;
        context('and then we create a subdeck under the deck', () => {
            before(() => {
                return server.inject({
                    method: 'POST',
                    url: '/decktree/node/create',
                    payload: {
                        selector: {
                            id: String(deckId),
                            spath: '',
                        },
                        nodeSpec: {
                            type: 'deck',
                        },
                    },
                    headers: {
                        '----jwt----': authToken,
                    },
                }).then((response) => {
                    if (response.statusCode !== 200) {
                        console.error(response.payload);
                        throw new Error(`could not add subdeck:\n\t${response.payload}`);
                    }
                    ({ id: subdeckId } = util.parseIdentifier(JSON.parse(response.payload).id));
                });
            });

            it('the subdeck usage should include the parent deck (DB)', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${subdeckId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.nested.property('revisions.0.usage').that.has.deep.members([
                        { id: deckId, revision: 1  },
                    ]);
                });
            });

            it('the subdeck usage should include the parent deck (API)', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${subdeckId}/usage`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.deep.members([
                        { id: deckId, revision: 1, theme: 'sky', using: 1 },
                    ]);
                });
            });

            it('the subdeck deep usage should include just the parent deck', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${subdeckId}/deepUsage`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.deep.members([
                        { id: deckId, revision: 1, theme: 'sky', using: 1 },
                    ]);
                });
            });

            it('the subdeck should have the deck as only root deck', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${subdeckId}/rootDecks`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.be.an('array').of.length(1);
                    payload.should.have.deep.members([
                        { id: deckId, revision: 1, hidden: false, using: 1 },
                    ]);
                });
            });

            let newSlideId;
            context('and then we create an additional slide under that subdeck', () => {
                before(() => {
                    return server.inject({
                        method: 'POST',
                        url: '/decktree/node/create',
                        payload: {
                            selector: {
                                id: String(deckId),
                                sid: String(subdeckId),
                                stype: 'deck',
                                spath: '',
                            },
                            nodeSpec: {
                                type: 'slide',
                            },
                        },
                        headers: {
                            '----jwt----': authToken,
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not add slide:\n\t${response.payload}`);
                        }
                        newSlideId = JSON.parse(response.payload).id;
                    });
                });

                it('the new slide deep usage should include the parent deck and the subdeck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${newSlideId}/deepUsage`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.deep.members([
                            { id: deckId, revision: 1, theme: 'sky' },
                            { id: subdeckId, revision: 1, theme: 'sky' },
                        ]);
                    });
                });

                it('the new slide should have the deck as only root deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${newSlideId}/rootDecks`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.be.an('array').of.length(1);
                        payload.should.have.deep.members([
                            { id: deckId, revision: 1, hidden: false },
                        ]);
                    });
                });

            });

            context('and then we move the subdeck', () => {
                before(() => {
                    return server.inject({
                        method: 'PUT',
                        url: '/decktree/node/move',
                        payload: {
                            sourceSelector: {
                                id: String(deckId),
                                spath: `${subdeckId}:3`,
                                stype: 'deck',
                                sid: String(subdeckId),
                            },
                            targetSelector: {
                                id: String(deckId),
                                spath: '',
                                stype: 'deck',
                                sid: String(deckId),
                            },
                            targetIndex: 0,
                        },
                        headers: {
                            '----jwt----': authToken,
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not move subdeck:\n\t${response.payload}`);
                        }
                    });
                });

                it('the subdeck usage should include the parent deck (DB)', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${subdeckId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.nested.property('revisions.0.usage').that.has.deep.members([
                            { id: deckId, revision: 1  },
                        ]);
                    });
                });

                it('the subdeck usage should include the parent deck (API)', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${subdeckId}/usage`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.deep.members([
                            { id: deckId, revision: 1, theme: 'sky', using: 1 },
                        ]);
                    });
                });

                it('the subdeck deep usage should include just the parent deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${subdeckId}/deepUsage`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.deep.members([
                            { id: deckId, revision: 1, theme: 'sky', using: 1 },
                        ]);
                    });
                });

                it('the subdeck should have the deck as only root deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${subdeckId}/rootDecks`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.be.an('array').of.length(1);
                        payload.should.have.deep.members([
                            { id: deckId, revision: 1, hidden: false, using: 1 },
                        ]);
                    });
                });

            });

            context('and then we move the slide in the subdeck', () => {
                before(() => {
                    return server.inject({
                        method: 'PUT',
                        url: '/decktree/node/move',
                        payload: {
                            sourceSelector: {
                                id: String(deckId),
                                spath: `${subdeckId}:;${newSlideId}:2`,
                                stype: 'slide',
                                sid: String(newSlideId),
                            },
                            targetSelector: {
                                id: String(deckId),
                                spath: '',
                                stype: 'deck',
                                sid: String(subdeckId),
                            },
                            targetIndex: 0,
                        },
                        headers: {
                            '----jwt----': authToken,
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not move slide:\n\t${response.payload}`);
                        }
                    });
                });

                it('the subdeck slide usage should include the subdeck (DB)', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${newSlideId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.nested.property('revisions.0.usage').that.has.deep.members([
                            { id: subdeckId, revision: 1  },
                        ]);
                    });
                });

                it('the subdeck slide usage should include the subdeck (API)', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${newSlideId}/usage`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.deep.members([
                            { id: subdeckId, revision: 1, theme: 'sky' },
                        ]);
                    });
                });

                it('the subdeck slide deep usage should include the parent deck and the subdeck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${newSlideId}/deepUsage`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.deep.members([
                            { id: deckId, revision: 1, theme: 'sky' },
                            { id: subdeckId, revision: 1, theme: 'sky' },
                        ]);
                    });
                });

                it('the subdeck slide should have the deck as only root deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${newSlideId}/rootDecks`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.be.an('array').of.length(1);
                        payload.should.have.deep.members([
                            { id: deckId, revision: 1, hidden: false },
                        ]);
                    });
                });

            });

            context('and then we move the slide out of the subdeck and to the parent deck', () => {
                before(() => {
                    return server.inject({
                        method: 'PUT',
                        url: '/decktree/node/move',
                        payload: {
                            sourceSelector: {
                                id: String(deckId),
                                spath: `${subdeckId}:;${newSlideId}:1`,
                                stype: 'slide',
                                sid: String(newSlideId),
                            },
                            targetSelector: {
                                id: String(deckId),
                                spath: '',
                                stype: 'deck',
                                sid: String(deckId),
                            },
                            targetIndex: 2,
                        },
                        headers: {
                            '----jwt----': authToken,
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not move slide:\n\t${response.payload}`);
                        }
                    });
                });

                it('the subdeck slide usage should include only the parent deck (DB)', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${newSlideId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.nested.property('revisions.0.usage').that.has.deep.members([
                            { id: deckId, revision: 1  },
                        ]);
                    });
                });

                it('the subdeck slide usage should include only the parent deck (API)', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${newSlideId}/usage`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.deep.members([
                            { id: deckId, revision: 1, theme: 'sky' },
                        ]);
                    });
                });

                it('the subdeck slide deep usage should only include the parent deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${newSlideId}/deepUsage`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.deep.members([
                            { id: deckId, revision: 1, theme: 'sky' },
                        ]);
                    });
                });

                it('the subdeck slide should have the parent deck as only root deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${newSlideId}/rootDecks`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.be.an('array').of.length(1);
                        payload.should.have.deep.members([
                            { id: deckId, revision: 1, hidden: false },
                        ]);
                    });
                });

            });

            context('and we create yet another subdeck under the subdeck', () => {
                before(() => {
                    return server.inject({
                        method: 'POST',
                        url: '/decktree/node/create',
                        payload: {
                            selector: {
                                id: String(deckId),
                                spath: '',
                                stype: 'deck',
                                sid: String(subdeckId),
                            },
                            nodeSpec: {
                                type: 'deck',
                            },
                        },
                        headers: {
                            '----jwt----': authToken,
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not add subdeck:\n\t${response.payload}`);
                        } 
                        subsubdeckId = JSON.parse(response.payload).id;
                    });
                });

                it('the sub-subdeck usage should include only the subdeck (DB)', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${subsubdeckId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.nested.property('revisions.0.usage').that.has.deep.members([
                            { id: subdeckId, revision: 1  },
                        ]);
                    });
                });

                it('the sub-subdeck usage should include only the subdeck (API)', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${subsubdeckId}/usage`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.deep.members([
                            { id: subdeckId, revision: 1, theme: 'sky' },
                        ]);
                    });
                });

                it('the sub-subdeck deep usage should include the subdeck and the deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${subsubdeckId}/deepUsage`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.deep.members([
                            { id: deckId, revision: 1, theme: 'sky' },
                            { id: subdeckId, revision: 1, theme: 'sky' },
                        ]);
                    });
                });

                it('the sub-subdeck should have the deck as only root deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${subsubdeckId}/rootDecks`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.be.an('array').of.length(1);
                        payload.should.have.deep.members([
                            { id: deckId, revision: 1, hidden: false },
                        ]);
                    });
                });

            });

        });

        context('and we attach some other deck to the deck', () => {
            let otherDeckId, otherSlides, attachedDeckId;
            before(() => {
                return server.inject({
                    method: 'POST',
                    url: '/deck/new',
                    payload: {
                        title: 'A deck to attach',
                    },
                    headers: {
                        '----jwt----': authToken,
                    },
                }).then((response) => {
                    if (response.statusCode !== 200) {
                        throw new Error(`could not create the other deck:\n\t${response.payload}`);
                    }
                    otherDeckId = JSON.parse(response.payload).id;

                    return Promise.all([
                        // add another slide there
                        server.inject({
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
                        }).then((response) => {
                            if (response.statusCode !== 200) {
                                throw new Error(`could not add a slide:\n\t${response.payload}`);
                            }

                            // and get the slide refs
                            return server.inject({
                                method: 'GET',
                                url: '/deck/' + otherDeckId,
                            }).then((response) => {
                                if (response.statusCode !== 200) {
                                    throw new Error(`could not get the other deck:\n\t${response.payload}`);
                                }
                                otherSlides = JSON.parse(response.payload).revisions[0].contentItems.map((i) => i.ref);
                            });
                        }),
                        // attach the deck
                        server.inject({
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
                        }).then((response) => {
                            if (response.statusCode !== 200) {
                                throw new Error(`could not attach the other deck:\n\t${response.payload}`);
                            }
                            attachedDeckId = JSON.parse(response.payload).id;
                        })
                    ]);

                });

            });

            it('the origin of the deck that was attached should not include the deck in its usage (DB)', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${otherDeckId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.nested.property('revisions.0.usage').that.is.an('array');
                    payload.revisions[0].usage.forEach((c) => c.should.not.have.property('id', deckId));
                });
            });

            it('the origin of the deck that was attached should not include the deck in its usage (API)', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${otherDeckId}/usage`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.be.an('array');
                    payload.forEach((c) => c.should.not.have.property('id', deckId));
                });
            });

            it('the deck as it was attached should include only the parent deck in its usage (DB)', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${attachedDeckId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.nested.property('revisions.0.usage').that.is.an('array');
                    payload.revisions[0].usage.should.have.deep.members([
                        { id: deckId, revision: 1 },
                    ]);
                });
            });

            it('the deck as it was attached should include only the parent deck in its usage (API)', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${attachedDeckId}/usage`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.deep.members([
                        { id: deckId, revision: 1, theme: 'sky' },
                    ]);
                });
            });

            context('and we attach directly two other slides', () => {
                let attachedSlideIds;
                before(() => {
                    return server.inject({
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
                            })),
                        },
                        headers: {
                            '----jwt----': authToken,
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            throw new Error(`could not attach the other slides:\n\t${response.payload}`);
                        }
                        attachedSlideIds = JSON.parse(response.payload).map((e) => e.id);
                    });
                });

                it('the origin of the slides that were attached should not include the deck in their usage (DB)', () => {
                    return Promise.all(otherSlides.map((slide) =>
                        server.inject({
                            method: 'GET',
                            url: `/slide/${slide.id}-${slide.revision}`,
                        }).then((response) => {
                            response.statusCode.should.equal(200);

                            let payload = JSON.parse(response.payload);
                            payload.should.have.nested.property('revisions.0.usage').that.is.an('array');
                            payload.revisions[0].usage.forEach((c) => c.should.not.have.property('id', deckId));
                        })                        
                    ));
                });

                it('the origin of the slides that were attached should not include the deck in their usage (API)', () => {
                    return Promise.all(otherSlides.map((slide) =>
                        server.inject({
                            method: 'GET',
                            url: `/slide/${slide.id}-${slide.revision}/usage`,
                        }).then((response) => {
                            response.statusCode.should.equal(200);

                            let payload = JSON.parse(response.payload);
                            payload.should.be.an('array');
                            payload.forEach((c) => c.should.not.have.property('id', deckId));
                        })                        
                    ));
                });

                it('the slides as they were attached should include only the parent deck in their usage (DB)', () => {
                    return Promise.all(attachedSlideIds.map((slideId) =>
                        server.inject({
                            method: 'GET',
                            url: `/slide/${slideId}`,
                        }).then((response) => {
                            response.statusCode.should.equal(200);

                            let payload = JSON.parse(response.payload);
                            payload.should.have.nested.property('revisions.0.usage').that.is.an('array');
                            payload.revisions[0].usage.should.have.deep.members([
                                { id: deckId, revision: 1 },
                            ]);
                        })                        
                    ));
                });

                it('the slides as they were attached should include only the parent deck in their usage (API)', () => {
                    return Promise.all(attachedSlideIds.map((slideId) =>
                        server.inject({
                            method: 'GET',
                            url: `/slide/${slideId}/usage`,
                        }).then((response) => {
                            response.statusCode.should.equal(200);

                            let payload = JSON.parse(response.payload);
                            payload.should.be.an('array');
                            payload.should.have.deep.members([
                                { id: deckId, revision: 1, theme: 'sky' },
                            ]);
                        })                        
                    ));
                });

            });

        });

        context('and we create a new revision of the root deck', () => {
            before(() => {
                return server.inject({
                    method: 'POST',
                    url: `/deck/${deckId}/revision`,
                    payload: {
                        top_root_deck: String(deckId),
                    },
                    headers: {
                        '----jwt----': authToken,
                    },
                }).then((response) => {
                    if (response.statusCode !== 200) {
                        throw new Error(`could not create deck revision:\n\t${response.payload}`);
                    }
                });
            });

            it('usage of subdeck should be updated with new revision (DB)', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${subdeckId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.nested.property('revisions.0.usage').that.has.deep.members([
                        { id: deckId, revision: 1 },
                    ]);
                    payload.should.have.nested.property('revisions.1.usage').that.has.deep.members([
                        { id: deckId, revision: 2 },
                    ]);
                });
            });

            it('usage of subdeck should be updated with new revision (API)', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${subdeckId}/usage`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.deep.have.members([
                        { id: deckId, revision: 1, theme: 'sky', using: 1 },
                        { id: deckId, revision: 2, theme: 'sky', using: 2 },
                    ]);
                });
            });

            it('deep usage of sub-subdeck should have been updated to include only the latest revisions', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${parseInt(subsubdeckId)}/deepUsage`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.deep.members([
                        { id: deckId, revision: 2, theme: 'sky', using: 2 },
                        { id: subdeckId, revision: 2, theme: 'sky', using: 2 },
                    ]);
                });
            });

            it('root deck of sub-subdeck should be at the same revision as the revision we created', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${parseInt(subsubdeckId)}/rootDecks`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.deep.members([
                        { id: deckId, revision: 2, hidden: false, using: 2 },
                    ]);
                });
            });

        });

    });

});
