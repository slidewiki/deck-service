/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

chai.should();

describe.skip('REST API contributors', () => {

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
                    language: 'en-GB',
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
                url: `/deck/${deckId}`,
            }).then((response) => {
                response.statusCode.should.equal(200);

                let payload = JSON.parse(response.payload);
                payload.should.have.property('contributors').that.has.deep.members([{ user: ownerId, count: 2 }]);
            });
        });

        it('the owner should be the only contributor to the first slide of the deck', () => {
            return server.inject({
                method: 'GET',
                url: `/slide/${firstSlide.id}-${firstSlide.revision}`,
            }).then((response) => {
                response.statusCode.should.equal(200);

                let payload = JSON.parse(response.payload);
                payload.should.have.property('contributors').that.has.deep.members([{ user: ownerId, count: 1 }]);
            });
        });

        context('and the owner updates the metadata of the deck', () => {
            before(() => {
                return server.inject({
                    method: 'PUT',
                    url: `/deck/${deckId}`,
                    payload: {
                        top_root_deck: String(deckId),
                        title: 'Updated deck title',
                        description: 'Updated deck description',
                        license: 'CC BY-SA',
                        language: 'en-GB',
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

            it('the owner should still be the only contributor to the deck, with three contributions', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${deckId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.property('contributors').that.has.deep.members([{ user: ownerId, count: 3 }]);
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

            it('the owner should have four contributions to the deck', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${deckId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.property('contributors').that.deep.includes({ user: ownerId, count: 4 });
                });
            });

            it('the owner should be the only contributor to the additional slide', () => {
                return server.inject({
                    method: 'GET',
                    url: `/slide/${slideId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.property('contributors').that.has.deep.members([{ user: ownerId, count: 1 }]);
                });
            });

            context.skip('and some editor renames the new slide', () => {
                let editorId = 4;
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

                it('the deck should have two contributors, with the editor having one contribution and the owner still four', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.property('contributors').that.has.deep.members([
                            { user: ownerId, count: 4 },
                            { user: editorId, count: 1 },
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

                    it('the deck should have again just owner as the only contributor, still with four contributions', () => {
                        return server.inject({
                            method: 'GET',
                            url: `/deck/${deckId}`,
                        }).then((response) => {
                            response.statusCode.should.equal(200);

                            let payload = JSON.parse(response.payload);
                            payload.should.have.property('contributors').that.has.deep.members([
                                { user: ownerId, count: 4 },
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

            it('the owner should have five contributions to the parent', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${deckId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.property('contributors').that.deep.includes({ user: ownerId, count: 5 });
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

                it('the owner should still have five contributions to the parent deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.property('contributors').that.deep.includes({ user: ownerId, count: 5 });
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
                        url: `/deck/${deckId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.property('contributors').that.deep.includes({ user: ownerId, count: 5 });
                    });
                });

                it('the subdeck should have two contributors, with the editor having one contribution', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${subdeckId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.property('contributors').that.is.an('array').of.length(2);
                        payload.contributors.should.that.deep.include({ user: editorId, count: 1 });
                    });
                });

            });

            context.skip('and another editor moves the subdeck', () => {
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
                        url: `/deck/${deckId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        // TODO fix this, moving adds one contribution to the subdeck owner
                        payload.should.have.property('contributors').that.deep.includes({ user: ownerId, count: 5 });
                        payload.contributors.forEach((c) => c.should.not.have.property('user', otherId));
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
                    url: `/deck/${deckId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.property('contributors').that.has.deep.members([
                        { user: ownerId, count: 5 },
                        { user: editorId, count: 1 },
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
                            throw new Error(`could not updates slide:\n\t${response.payload}`);
                        }
                    });
                });

                it('the deck should have three contributors, with the editors having one contribution each, and the owner still five', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.property('contributors').that.has.deep.members([
                            { user: ownerId, count: 5 },
                            { user: editorId, count: 1 },
                            { user: otherId, count: 1 },
                        ]);
                    });
                });

                it('the slide should have two contributors, having one contribution each', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${slideId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.property('contributors').that.has.deep.members([
                            { user: editorId, count: 1 },
                            { user: otherId, count: 1 },
                        ]);
                    });
                });

                context.skip('and that other editor moves the additional slide', () => {
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
                            url: `/deck/${deckId}`,
                        }).then((response) => {
                            response.statusCode.should.equal(200);

                            let payload = JSON.parse(response.payload);
                            payload.should.have.property('contributors').that.deep.includes.members([
                                { user: otherId, count: 1 },
                                // TODO fix this
                                // { user: editorId, count: 1 },
                            ]);
                        });
                    });

                });

            });

            context.skip('and another editor duplicates the additional slide', () => {
                let duplicateSlideId;
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
                            '----jwt----': tokenFor(otherId),
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not updates slide:\n\t${response.payload}`);
                        }
                        duplicateSlideId = JSON.parse(response.payload).id;
                    });
                });

                // TODO fix this, the contributions are reversed
                it.skip('the editor that copied the slide should have two contributions to the deck, while the revision owner of the slide should still have one', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.property('contributors').that.includes.deep.members([
                            { user: editorId, count: 1 },
                            { user: otherId, count: 2 },
                        ]);
                    });
                });

                it('the editor that copied the slide and the revision owner of the slide should have one contribution each to the slide copy', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${duplicateSlideId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.property('contributors').that.has.deep.members([
                            { user: editorId, count: 1 },
                            { user: otherId, count: 1 },
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

            it('the deck should have three contributors, with one editor having one, the other two, and the owner still five', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${deckId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.property('contributors').that.has.deep.members([
                        { user: editorId, count: 1 },
                        { user: otherId, count: 2 },
                        { user: ownerId, count: 5 },
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

                it('the editor should still have two contributions to the parent', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.property('contributors').that.deep.includes({ user: otherId, count: 2 });
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

                it('the editor should still have two contributions to the root deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.property('contributors').that.deep.includes({ user: otherId, count: 2 });
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
                        language: 'en-GB',
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

            it('the owner should have six contributions to the deck', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${deckId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.property('contributors').that.deep.includes({ user: ownerId, count: 6 });
                });
            });

            it('the owner should have one contribution to the deck as it was attached', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${attachedDeckId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.property('contributors').that.deep.includes({ user: ownerId, count: 1 });
                });
            });

            it('the owner should have zero contributions to the origin deck that was attached', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${otherDeckId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.property('contributors').that.is.an('array');
                    payload.contributors.forEach((c) => c.should.not.have.property('user', ownerId));
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

                it('the original slide author should have two contributions to the root deck (and the editor three ???)', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.property('contributors').that.deep.includes.members([
                            { user: someUserId, count: 2 },
                            // TODO fix this
                            // { user: editorId, count: 3 },
                        ]);
                    });
                });

                it('the original slide author (and the editor ???) should have one contribution each to both slides as they were attached', () => {

                    return Promise.all(attachedSlideIds.map((attachedSlideId) => {
                        return server.inject({
                            method: 'GET',
                            url: `/slide/${attachedSlideId}`,
                        }).then((response) => {
                            response.statusCode.should.equal(200);

                            let payload = JSON.parse(response.payload);
                            payload.should.have.property('contributors').that.deep.includes.members([
                                { user: someUserId, count: 1 },
                                // TODO fix this
                                // { user: editorId, count: 1 },
                            ]);
                        });
                    }));

                });

                it('the editor should have zero contributions to the origin slides that were attached', () => {

                    return Promise.all(otherSlides.map((otherSlide) => {
                        return server.inject({
                            method: 'GET',
                            url: `/slide/${otherSlide.id}-${otherSlide.revision}`,
                        }).then((response) => {
                            response.statusCode.should.equal(200);

                            let payload = JSON.parse(response.payload);
                            payload.should.have.property('contributors').that.is.an('array');
                            payload.contributors.forEach((c) => c.should.not.have.property('user', editorId));
                        });
                    }));

                });

            });

        });

    });

});
