/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

chai.should();

describe('REST API contributors', () => {

    const JWT = require('jsonwebtoken');
    const secret = 'NeverShareYourSecret';
    const tokenFor = (userid) => JWT.sign( { userid }, secret);

    let server;

    before((done) => {
        // Clean everything up before doing new tests
        Object.keys(require.cache).forEach((key) => delete require.cache[key]);

        require('../testServer')(secret).then((newServer) => {
            server = newServer;
            server.start(done);
        });
    });

    after(() => {
        return Promise.resolve().then(() => server && server.stop());
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
                    language: 'en-GB',
                    editors: { users: [
                        {id: 2, joined: new Date().toISOString() },
                        {id: 3, joined: new Date().toISOString() },
                    ] },
                },
                headers: {
                    '----jwt----': tokenFor(1),
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
                payload.should.have.nested.property('contributors').of.length(1);
                payload.should.have.nested.property('contributors.0').that.eql({ user: 1, count: 2 });
            });
        });

        it('the owner should be the only contributor to the first slide of the deck', () => {
            return server.inject({
                method: 'GET',
                url: `/slide/${firstSlide.id}-${firstSlide.revision}`,
            }).then((response) => {
                response.statusCode.should.equal(200);

                let payload = JSON.parse(response.payload);
                payload.should.have.nested.property('contributors').of.length(1);
                payload.should.have.nested.property('contributors.0').that.eql({ user: 1, count: 1 });
            });
        });

        context('and the owner creates a subdeck under that', () => {
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
                        '----jwt----': tokenFor(1),
                    },
                }).then((response) => {
                    // console.log(response.payload);
                    if (response.statusCode !== 200) {
                        console.error(response.payload);
                        throw new Error(`could not add subdeck:\n\t${response.payload}`);
                    } 
                    subdeckId = JSON.parse(response.payload).id;
                });
            });

            it('the owner should have 3 contributions to the parent', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${deckId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.nested.property('contributors').of.length(1);
                    payload.should.have.nested.property('contributors.0').that.eql({ user: 1, count: 3 });
                });
            });

            it('the owner should have 2 contributions to the new subdeck', () => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${subdeckId}`,
                }).then((response) => {
                    response.statusCode.should.equal(200);

                    let payload = JSON.parse(response.payload);
                    payload.should.have.nested.property('contributors').of.length(1);
                    payload.should.have.nested.property('contributors.0').that.eql({ user: 1, count: 2 });
                });
            });

            context('and then create an additional slide', () => {
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
                            '----jwt----': tokenFor(1),
                        },
                    }).then((response) => {
                        if (response.statusCode !== 200) {
                            console.error(response.payload);
                            throw new Error(`could not add slide:\n\t${response.payload}`);
                        }
                        slideId = JSON.parse(response.payload).id;
                    });
                });

                it('the owner should have 4 contributions to the deck', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/deck/${deckId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.nested.property('contributors').of.length(1);
                        payload.should.have.nested.property('contributors.0').that.eql({ user: 1, count: 4 });
                    });
                });

                it('the owner should be the only contributor to the additional slide', () => {
                    return server.inject({
                        method: 'GET',
                        url: `/slide/${slideId}`,
                    }).then((response) => {
                        response.statusCode.should.equal(200);

                        let payload = JSON.parse(response.payload);
                        payload.should.have.nested.property('contributors').of.length(1);
                        payload.should.have.nested.property('contributors.0').that.eql({ user: 1, count: 1 });
                    });
                });

            });

        });

    });

});
