/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

describe('REST API', () => {

    const JWT = require('jsonwebtoken');
    const secret = 'NeverShareYourSecret';
    
    let server;

    before((done) => {
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
                
                /*
                const config = require('../configuration'),
                    db = require('../database/helper');
                db.cleanDatabase(config.MongoDB.SLIDEWIKIDATABASE);
                */
                
                server.start(() => {
                    server.log('info', 'Server started at ' + server.info.uri);
                    require('../routes.js')(server);
                    done();
                });
            }
        });
    });

    const deckData = {
        tags: [
            { 
                tagName: 'tagOne'
            },
            { 
                tagName: 'tagTwo'
            }
        ],
        title: 'new deck',
    };
    
    let authToken = JWT.sign( { userid: 1 }, secret );
    
    let options = {
        method: 'PUT',
        url: '/deck/', // + '{id}/tags'
        headers: {
            'Content-Type': 'application/json',
            '----jwt----': '',
        }
    };        
    
	let deckID; // id of the newly greated deck
	
    context('when replacing the tags of a deck', () => {
        it('it should reply the deck with replaced tags', () => {
            return server.inject({
                method: 'POST',
                url: '/deck/new',
                payload: deckData,
                headers: {
                    'Content-Type': 'application/json',
                    '----jwt----': authToken,
                },
            }).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('user', 'timestamp', 'revisions', 'id', 'license');
                payload.user.should.equal(1);
                deckID = String(payload.id);
                payload.license.should.equal('CC BY-SA');
                payload.revisions.should.be.an('array').and.have.length(1);
                let revision = payload.revisions[0];
                revision.should.be.an('object').and.contain.keys('timestamp', 'user', 'tags');
                revision.user.should.equal(1);
                revision.tags.should.be.an('array').and.have.length(2);
            }).then((response) => {
                let opt = JSON.parse(JSON.stringify(options));
                opt.payload = {
                    top_root_deck: deckID,
                    tags: [
                        {
                            tagName: 'replacedTag'
                        }
                    ]
                };
                opt.headers['----jwt----'] = authToken;
                opt.url += deckID + '/tags';
                return server.inject(opt).then((response) => {
                    response.should.be.an('object').and.contain.keys('statusCode','payload');
                    response.statusCode.should.equal(200);
                    response.payload.should.be.a('string');
                    let payload = JSON.parse(response.payload);
                    payload.should.be.an('object').and.contain.keys('user', 'timestamp', 'license', 'revisions');
                    payload.user.should.equal(1);
                    payload.revisions.should.be.an('array').and.have.length(1);
                    let revision = payload.revisions[0];
                    revision.should.be.an('object').and.contain.keys('timestamp', 'user', 'tags');
                    revision.user.should.equal(1);
                    revision.tags.should.be.an('array').and.have.length(1);
                });
            });
        });
        it('it should return 404 if not an existing deck', () => {   
            let opt = JSON.parse(JSON.stringify(options));
            opt.payload = {
                top_root_deck: deckID,
                tags: []
            };
            opt.headers['----jwt----'] = authToken;
            opt.url += 'dummy/tags'; // string works
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(404);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                payload.error.should.equal('Not Found');
            });
        });  
        it('it should return 401 if JWT-login is wrong', () => {
            let opt = JSON.parse(JSON.stringify(options));
            opt.payload = {
            top_root_deck: deckID,
                tags: []
            };
            opt.url += deckID + '/tags'; // string works
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(401);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                payload.error.should.equal('Unauthorized');
            });
        });
        it('it should return 400 if input is invalid', () => {
            let opt = JSON.parse(JSON.stringify(options));
            opt.payload = {};
            opt.headers['----jwt----'] = authToken
            opt.url += deckID + '/tags'; // string works
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(400);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                payload.error.should.equal('Bad Request');
            });
        });
    });  
});