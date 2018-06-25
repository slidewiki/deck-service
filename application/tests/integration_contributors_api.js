/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

chai.should();

describe('REST API contributors api', () => {

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


    let ownerId = 1, editorId = 2, otherId = 3;
    context('when creating a new deck', () => {
        let deckId, firstSlide;

        before(() => {
            return server.inject({
                method: 'POST',
                url: '/deck/new',
                payload: {
                    title: 'The root for contribution tests',
                    language: 'en',
                    editors: { users: [1, 2, 3, 4, 5].map((id) =>
                        ({ id, joined: new Date().toISOString() })
                    )},
                },
                headers: {
                    '----jwt----': tokenFor(ownerId),
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

        it('the owner should be the only contributor to the deck, with two contributions', () => {
            return server.inject({
                method: 'GET',
                url: `/deck/${deckId}/contributors`,
            }).then((response) => {
                response.statusCode.should.equal(200);

                let payload = JSON.parse(response.payload);
                payload.should.have.deep.members([{ id: ownerId, type: 'creator', count: 2 }]);
            });
        });

        it('the owner should be the only contributor to the first slide of the deck', () => {
            return server.inject({
                method: 'GET',
                url: `/slide/${firstSlide.id}-${firstSlide.revision}/contributors`,
            }).then((response) => {
                response.statusCode.should.equal(200);

                let payload = JSON.parse(response.payload);
                payload.should.have.deep.members([{ id: ownerId, type: 'creator', count: 1 }]);
            });
        });


        context('and the owner updates the metadata of the deck and creates a deck revision', () => {
            before(() => {
                return server.inject({
                    method: 'PUT',
                    url: `/deck/${deckId}`,
                    payload: {
                        top_root_deck: String(deckId),
                        title: 'Updated deck title',
                        description: 'Updated deck description',
                        license: 'CC BY-SA',
                        language: 'en',
                    },
                    headers: {
                        '----jwt----': tokenFor(ownerId),
                    },
                }).then((response) => {
                    if (response.statusCode !== 200) {
                        console.error(response.payload);
                        throw new Error(`could not update deck:\n\t${response.payload}`);
                    }
                });
            });

            it('the owner should still be the only contributor to the deck, with two contributions', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${deckId}/contributors`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.deep.members([{ id: ownerId, type: 'creator', count: 2 }]);
                });
            });

        });

        context('and the owner adds an additional slide', () => {
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
                        '----jwt----': tokenFor(ownerId),
                    },
                }).then((response) => {
                    if (response.statusCode !== 200) {
                        console.error(response.payload);
                        throw new Error(`could not add slide:\n\t${response.payload}`);
                    }
                    slideId = JSON.parse(response.payload).id;
                });
            });

            it('the owner should have three contributions to the deck', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${deckId}/contributors`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.deep.include({ id: ownerId, type: 'creator', count: 3 });
                });
            });

            it('the owner should be the only contributor to the additional slide', () => {
                return server.inject({
                    method: 'GET',
                    url: `/slide/${slideId}/contributors`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.deep.members([{ id: ownerId, type: 'creator', count: 1 }]);
                });
            });

            context('and some editor renames the new slide', () => {
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
                            '----jwt----': tokenFor(editorId),
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not rename slide:\n\t${response.payload}`);
                        }
                    });
                });

                it('the deck should have two contributors, with the editor having one contribution and the owner still three', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}/contributors`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.deep.members([
                            { id: ownerId, type: 'creator', count: 3 },
                            { id: editorId, type: 'contributor', count: 1 },
                        ]);
                    });
                });

                context('and then that slide is removed altogether', () => {
                    before(() => {
                        return server.inject({
                            method: 'DELETE',
                            url: '/decktree/node/delete',
                            payload: {
                                selector: {
                                    id: String(deckId),
                                    spath: `${slideId}:2`,
                                    stype: 'slide',
                                    sid: String(slideId),
                                },
                            },
                            headers: {
                                '----jwt----': tokenFor(editorId),
                            },
                        }).then((response) => {
                            if (response.statusCode !== 200) {
                                console.error(response.payload);
                                throw new Error(`could not delete slide:\n\t${response.payload}`);
                            }
                        });
                    });

                    it('the deck should have again just owner as the only contributor, now with two contributions', () => {
                        return server.inject({
                            method: 'GET',
                            url: `/deck/${deckId}/contributors`,
                        }).then((response) => {
                            response.statusCode.should.equal(200);

                            let payload = JSON.parse(response.payload);
                            payload.should.have.deep.members([
                                { id: ownerId, type: 'creator', count: 2 },
                            ]);
                        });
                    });

                });

            });

        });

        context('and the owner creates a subdeck under the deck', () => {
            let subdeckId;
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
                        '----jwt----': tokenFor(ownerId),
                    },
                }).then((response) => {
                    if (response.statusCode !== 200) {
                        console.error(response.payload);
                        throw new Error(`could not add subdeck:\n\t${response.payload}`);
                    } 
                    subdeckId = JSON.parse(response.payload).id;
                });
            });

            it('the owner should have four contributions to the parent', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${deckId}/contributors`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.deep.include({ id: ownerId, type: 'creator', count: 4 });
                });
            });

            context('and then creates an additional slide under that subdeck', () => {
                let slideId;
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
                            '----jwt----': tokenFor(ownerId),
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not add slide:\n\t${response.payload}`);
                        }
                        slideId = JSON.parse(response.payload).id;
                    });
                });

                it('the owner should still five contributions to the parent deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}/contributors`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.deep.include({ id: ownerId, type: 'creator', count: 5 });
                    });
                });

            });

            context('and an editor updates the metadata of the subdeck', () => {
                before(() => {
                    return server.inject({
                        method: 'PUT',
                        url: `/deck/${subdeckId}`,
                        payload: {
                            root_deck: String(deckId),
                            top_root_deck: String(deckId),
                            title: 'Updated subdeck title',
                            description: 'Updated subdeck description',
                        },
                        headers: {
                            '----jwt----': tokenFor(editorId),
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not update subdeck:\n\t${response.payload}`);
                        } 
                    });
                });

                it('the owner should still be the only contributor to the parent with five contributions', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}/contributors`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.deep.include({ id: ownerId, type: 'creator', count: 5 });
                    });
                });

                it('the subdeck should also include just one contributor, not the editor that updated the metadata', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${subdeckId}/contributors`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.be.an('array').of.length(1);
                        payload.forEach((c) => c.should.not.have.property('id', editorId));
                    });
                });

            });

            context('and another editor moves the subdeck', () => {
                before(() => {
                    return server.inject({
                        method: 'PUT',
                        url: '/decktree/node/move',
                        payload: {
                            sourceSelector: {
                                id: String(deckId),
                                spath: `${subdeckId}:2`,
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
                            '----jwt----': tokenFor(otherId),
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not move subdeck:\n\t${response.payload}`);
                        }
                    });
                });

                it('the editor that moved the subdeck should not have any contributions and the owner of the subdeck should still have five contributions to the deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}/contributors`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.deep.include({ id: ownerId, type: 'creator', count: 5 });
                        payload.forEach((c) => c.should.not.have.property('id', otherId));
                    });
                });

            });

        });


        context('and an editor adds an additional slide', () => {
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
                        '----jwt----': tokenFor(editorId),
                    },
                }).then((response) => {
                    if (response.statusCode !== 200) {
                        console.error(response.payload);
                        throw new Error(`could not add slide:\n\t${response.payload}`);
                    }
                    slideId = JSON.parse(response.payload).id;
                });
            });

            it('the deck should have two contributors, with the editor having one contribution and the owner still five', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${deckId}/contributors`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.deep.members([
                        { id: ownerId, type: 'creator', count: 5 },
                        { id: editorId, type: 'contributor', count: 1 },
                    ]);
                });
            });

            context('and another editor updates the additional slide', () => {
                before(() => {
                    return server.inject({
                        method: 'PUT',
                        url: `/slide/${slideId}`,
                        payload: {
                            top_root_deck: String(deckId),
                            root_deck: String(deckId),
                            title: 'New Slide',
                            content: `<h1>I am a slide edited by ${otherId}</h1>`,
                        },
                        headers: {
                            '----jwt----': tokenFor(otherId),
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not update slide:\n\t${response.payload}`);
                        }
                        // TODO change this WEIRD payload
                        let payload = JSON.parse(response.payload);
                        slideId = `${payload._id}-${payload.revisions.slice(-1)[0].id}`;
                    });
                });

                it('the deck should have three contributors, with the editors having one contribution each, and the owner still five', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}/contributors`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.deep.members([
                            { id: ownerId, type: 'creator', count: 5 },
                            { id: editorId, type: 'contributor', count: 1 },
                            { id: otherId, type: 'contributor', count: 1 },
                        ]);
                    });
                });

                it('the slide should have two contributors, having one contribution each', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${slideId}/contributors`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.deep.members([
                            { id: editorId, type: 'creator', count: 1 },
                            { id: otherId, type: 'contributor', count: 1 },
                        ]);
                    });
                });

                context('and that other editor moves the additional slide', () => {
                    before(() => {
                        return server.inject({
                            method: 'PUT',
                            url: '/decktree/node/move',
                            payload: {
                                sourceSelector: {
                                    id: String(deckId),
                                    spath: `${slideId}:3`,
                                    stype: 'slide',
                                    sid: String(slideId),
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
                                '----jwt----': tokenFor(otherId),
                            },
                        }).then((response) => {
                            if (response.statusCode !== 200) {
                                console.error(response.payload);
                                throw new Error(`could not move slide:\n\t${response.payload}`);
                            }
                        });
                    });

                    it('the editor that moved the slide and the revision owner of the slide should still have one contribution each to the deck', () => {
                        return server.inject({
                            method: 'GET',
                            url: `/deck/${deckId}/contributors`,
                        }).then((response) => {
                            response.statusCode.should.equal(200);

                            let payload = JSON.parse(response.payload);
                            payload.should.deep.include.members([
                                { id: otherId, type: 'contributor', count: 1 },
                                { id: editorId, type: 'contributor', count: 1 },
                            ]);
                        });
                    });

                });

            });

            context('and another editor duplicates the additional slide', () => {
                let anotherId = 4, duplicateSlideId;
                before(() => {
                    return server.inject({
                        method: 'POST',
                        url: '/decktree/node/create',
                        payload: {
                            selector: {
                                id: String(deckId),
                                spath: ' ',
                                stype: 'slide',
                                sid: String(slideId),
                            },
                            nodeSpec: {
                                type: 'slide',
                                id: String(slideId),
                            },
                        },
                        headers: {
                            '----jwt----': tokenFor(anotherId),
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not duplicate slide:\n\t${response.payload}`);
                        }
                        duplicateSlideId = JSON.parse(response.payload).id;
                    });
                });

                it('the editor that copied the slide should have one contribution to the deck and the revision owner of the slide should have two contributions', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}/contributors`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.deep.include.members([
                            { id: anotherId, type: 'contributor', count: 1 },
                            { id: otherId, type: 'contributor', count: 2 },
                        ]);
                    });
                });

                it('the editor that copied the slide and the revision owner of the slide should have one contribution each to the slide copy', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${duplicateSlideId}/contributors`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.deep.members([
                            { id: anotherId, type: 'creator', count: 1 },
                            { id: otherId, type: 'contributor', count: 1 },
                        ]);
                    });
                });

            });

        });

        context('and another editor creates a subdeck under the deck', () => {
            let subdeckId;
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
                        '----jwt----': tokenFor(otherId),
                    },
                }).then((response) => {
                    if (response.statusCode !== 200) {
                        console.error(response.payload);
                        throw new Error(`could not add subdeck:\n\t${response.payload}`);
                    } 
                    subdeckId = JSON.parse(response.payload).id;
                });
            });

            it('the subdeck creator should have four contributions to the parent deck, with the owner still five', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${deckId}/contributors`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.deep.include.members([
                        { id: otherId, type: 'contributor', count: 4 },
                        { id: ownerId, type: 'creator', count: 5 },
                    ]);
                });
            });

            context('and then creates an additional slide under that subdeck', () => {
                let slideId;
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
                            '----jwt----': tokenFor(otherId),
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not add slide:\n\t${response.payload}`);
                        }
                        slideId = JSON.parse(response.payload).id;
                    });
                });

                it('the editor should have five contributions to the parent', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}/contributors`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.deep.include({ id: otherId, type: 'contributor', count: 5 });
                    });
                });

            });

            context('and then creates an additional subdeck under that subdeck', () => {
                let subsubdeckId;
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
                                type: 'deck',
                            },
                        },
                        headers: {
                            '----jwt----': tokenFor(otherId),
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not add slide:\n\t${response.payload}`);
                        }
                        subsubdeckId = JSON.parse(response.payload).id;
                    });
                });

                it('the editor should have seven contributions to the root deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}/contributors`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.deep.include({ id: otherId, type: 'contributor', count: 7 });
                    });
                });

            });

        });

        context('and the owner attaches to the deck another one created by some user', () => {
            let otherDeckId, otherSlides, attachedDeckId, someUserId = 666;
            before(() => {
                return server.inject({
                    method: 'POST',
                    url: '/deck/new',
                    payload: {
                        title: 'A deck to attach',
                        language: 'en',
                    },
                    headers: {
                        '----jwt----': tokenFor(someUserId),
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
                                '----jwt----': tokenFor(someUserId),
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
                                '----jwt----': tokenFor(ownerId),
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

            it('the owner should have six contributions to the deck, and the original author of the deck that was attached, one', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${deckId}/contributors`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.deep.include.members([
                        { id: ownerId, type: 'creator', count: 6 },
                        { id: someUserId, type: 'contributor', count: 1 },
                    ]);
                });
            });

            it('the owner should have one contribution to the deck as it was attached, and the original author of the deck, one', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${attachedDeckId}/contributors`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.deep.include.members([
                        { id: ownerId, type: 'creator', count: 1 },
                        { id: someUserId, type: 'contributor', count: 1 },
                    ]);
                });
            });

            it('the owner should have zero contributions to the origin deck that was attached', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${otherDeckId}/contributors`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.be.an('array');
                    payload.forEach((c) => c.should.not.have.property('id', ownerId));
                });
            });

            context('and an editor attaches to the deck two slides created by some user', () => {
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
                            '----jwt----': tokenFor(editorId),
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            throw new Error(`could not attach the other slides:\n\t${response.payload}`);
                        }
                        attachedSlideIds = JSON.parse(response.payload).map((e) => e.id);
                    });
                });

                it('the original slide author should have three contributions to the root deck, and the editor also three', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}/contributors`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.deep.include.members([
                            { id: someUserId, type: 'contributor', count: 3 },
                            { id: editorId, type: 'contributor', count: 3 },
                        ]);
                    });
                });

                it('the original slide author (and the editor ???) should have one contribution each to both slides as they were attached', () => {

                    return Promise.all(attachedSlideIds.map((attachedSlideId) => {
                        return server.inject({
                            method: 'GET',
                            url: `/slide/${attachedSlideId}/contributors`,
                        }).then((response) => {
                            response.statusCode.should.equal(200);

                            let payload = JSON.parse(response.payload);
                            payload.should.deep.include.members([
                                { id: editorId, type: 'creator', count: 1 },
                                { id: someUserId, type: 'contributor', count: 1 },
                            ]);
                        });
                    }));

                });

                it('the editor should have zero contributions to the origin slides that were attached', () => {

                    return Promise.all(otherSlides.map((otherSlide) => {
                        return server.inject({
                            method: 'GET',
                            url: `/slide/${otherSlide.id}-${otherSlide.revision}/contributors`,
                        }).then((response) => {
                            response.statusCode.should.equal(200);

                            let payload = JSON.parse(response.payload);
                            payload.should.be.an('array');
                            payload.forEach((c) => c.should.not.have.property('id', editorId));
                        });
                    }));

                });

            });

        });

    });

});
