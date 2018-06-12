/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

chai.should();

describe('REST API new slide', () => {

    const JWT = require('jsonwebtoken');
    const secret = 'NeverShareYourSecret';

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


    let slide = {
        title: 'Dummy',
        content: 'dummy',
        language: 'en',
        license: 'CC0',
        root_deck: '25-1'
    };

    let authToken = JWT.sign( { userid: 1 }, secret );

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
