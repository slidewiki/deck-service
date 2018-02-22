/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

//Mocking is missing completely TODO add mocked objects

describe('REST API', () => {

    const JWT = require('jsonwebtoken');
    const secret = 'NeverShareYourSecret';

    let server;

    beforeEach((done) => {
        //Clean everything up before doing new tests
        Object.keys(require.cache).forEach((key) => delete require.cache[key]);
        require('chai').should();
        let hapi = require('hapi');
        server = new hapi.Server();
        server.connection({
            host: 'localhost',
            port: 3000
        });
        let plugins = [
            require('hapi-auth-jwt2')
        ];
        server.register(plugins, (err) => {
            if (err) {
                console.error(err);
                global.process.exit();
            } else {
                server.auth.strategy('jwt', 'jwt', {
                    key: secret,
                    validateFunc: (decoded, request, callback) => {callback(null, true);},
                    verifyOptions: {
                        ignoreExpiration: true
                    },
                    headerKey: '----jwt----',
                });

                server.start(() => {
                    server.log('info', 'Server started at ' + server.info.uri);
                    require('../routes.js')(server);
                    done();
                });
            }
        });
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
