/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

chai.should();

describe('REST API new slide', () => {

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


    let slide = {
        title: 'Dummy',
        content: 'dummy',
        language: 'en',
        license: 'CC0',
        root_deck: '25-1'
    };

    let authToken = tokenFor(1);

    let options = {
        method: 'POST',
        url: '/slide/new',
        payload: slide,
        headers: {
            'Content-Type': 'application/json',
            '----jwt----': authToken,
        }
    };

    // this api method should be deprecated at some point
    context('when creating a slide it', () => {
        it('should reply it', () => {
            return server.inject(options).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('language', 'timestamp', 'user');
                payload.language.should.equal('en');
                payload.user.should.equal(1);
            });
        });
    });

    context('when creating a deck it', () => {
        it('should reply it', () => {
            return server.inject({
                method: 'POST',
                url: '/deck/new',
                payload: {
                    title: 'new deck',
                },
                headers: {
                    'Content-Type': 'application/json',
                    '----jwt----': authToken,
                },
            }).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('license', 'timestamp', 'user');
                payload.license.should.equal('CC BY-SA');
                payload.user.should.equal(1);
            });
        });
    });

    context('when appending a slide to a deck', () => {
        it('should reply it', () => {
            return server.inject({
                method: 'POST',
                url: '/deck/new',
                payload: {
                    title: 'new deck',
                    slideDimensions: { width: 400, height: 200 },
                },
                headers: {
                    'Content-Type': 'application/json',
                    '----jwt----': authToken,
                },
            }).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('license', 'timestamp', 'user');
                payload.license.should.equal('CC BY-SA');
                payload.user.should.equal(1);
                payload.should.have.a.nested.property('slideDimensions.width', 400);
                payload.should.have.a.nested.property('slideDimensions.height', 200);


                return server.inject({
                    method: 'POST',
                    url: '/decktree/node/create',
                    payload: {
                        selector: {
                            id: String(payload.id),
                            spath: '',
                        },
                        nodeSpec: {
                            type: 'slide',
                        },
                    },
                    headers: {
                        'Content-Type': 'application/json',
                        '----jwt----': authToken,
                    },
                }).then((addResponse) => {
                    addResponse.should.be.an('object').and.contain.keys('statusCode','payload');
                    addResponse.statusCode.should.equal(200);
                    addResponse.payload.should.be.a('string');
                    let payload = JSON.parse(addResponse.payload);
                    payload.should.be.an('object').and.contain.keys('title', 'id', 'type');
                });

            });

        });
    });

});
