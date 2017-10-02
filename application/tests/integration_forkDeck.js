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
    
    let authToken = JWT.sign( { userid: 1 }, secret );
    let authToken2 = JWT.sign( { userid: 2 }, secret );
    
    let options = {
        method: 'PUT',
        url: '/deck/', // + '{id}/fork'
        headers: {
            'Content-Type': 'application/json',
            '----jwt----': '',
        }
    };
    
    let options2 = {
        method: 'GET',
        url: '/deck/', // + '{id}/forks?user={id}', + '{id}/forkCount?user={id}', + '{id}/forkGroup
        headers: {
            'Content-Type': 'application/json',
        }
    };
    
    let deckID; // id of the newly created deck
    
    context('when creating a fork for a deck', () => {
        it('it should reply the new root deck and id map', () => {
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
                payload.should.be.an('object').and.contain.keys('user', 'timestamp', 'revisions', 'id', 'license');
                payload.user.should.equal(1);
                deckID = String(payload.id);
                payload.license.should.equal('CC BY-SA');
                payload.revisions.should.be.an('array').and.have.length(1);
            }).then(() => {
                let opt = JSON.parse(JSON.stringify(options));
                opt.payload = {};
                opt.headers['----jwt----'] = authToken;
                opt.url += deckID + '/fork';
                return server.inject(opt).then((response) => {
                    response.should.be.an('object').and.contain.keys('statusCode','payload');
                    response.statusCode.should.equal(200);
                    response.payload.should.be.a('string');
                    let payload = JSON.parse(response.payload);
                    payload.should.be.an('object').and.contain.keys('root_deck', 'id_map');
                    payload.root_deck.should.be.a('string').and.equal( ( parseInt(deckID) + 1 ) + '-1' );
                    payload.id_map.should.be.an('object').and.contain.keys( deckID + '-1' );
                }).then(() => {
                    let opt = JSON.parse(JSON.stringify(options));
                    opt.payload = {};
                    opt.headers['----jwt----'] = authToken2;
                    opt.url += deckID + '/fork';
                    return server.inject(opt).then((response) => {
                        response.should.be.an('object').and.contain.keys('statusCode','payload');
                        response.statusCode.should.equal(200);
                        response.payload.should.be.a('string');
                        let payload = JSON.parse(response.payload);
                        payload.should.be.an('object').and.contain.keys('root_deck', 'id_map');
                        payload.root_deck.should.be.a('string').and.equal( ( parseInt(deckID) + 2 ) + '-1' );
                        payload.id_map.should.be.an('object').and.contain.keys( deckID + '-1' );
                    });
                });
            });
        });
        it('it should return 403 if not a valid deck to fork from', () => { // QUESTION why not 404?
            let opt = JSON.parse(JSON.stringify(options));
            opt.payload = {};
            opt.headers['----jwt----'] = authToken;
            opt.url += 'dummy/fork'; // string works
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(403);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                payload.error.should.equal('Forbidden');
            });
        });
        it('it should return 401 if JWT-login is wrong', () => {
            let opt = JSON.parse(JSON.stringify(options));
            opt.payload = {};
            opt.url += deckID + '/fork';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(401);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                payload.error.should.equal('Unauthorized');
            });
        });
    });
    
    context('when getting the forks and the fork count for a deck', () => {
        it('it should reply all forks', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += deckID + '/forks';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('array').and.have.length(2);
                payload[0].should.be.an('object').and.contain.keys('user', 'timestamp', 'origin');
                payload[0].user.should.equal(1);
                payload[1].should.be.an('object').and.contain.keys('user', 'timestamp', 'origin');
                payload[1].user.should.equal(2);
            });
        });
        it('it should reply all forks for a user', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += deckID + '/forks?user=1';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('array').and.have.length(1);
                payload[0].should.be.an('object').and.contain.keys('user', 'timestamp', 'origin');
                payload[0].user.should.equal(1);
            });
        });
        it('it should reply the count of forks', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += deckID + '/forkCount';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string').and.equal('2');
            });
        });
        it('it should reply the count of forks for a user', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += deckID + '/forkCount?user=1';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string').and.equal('1');
            });
        });
        it('it should return 404 if not an existing deck', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += '9999/fork'; // number required
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(404);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                payload.error.should.equal('Not Found');
            }).then(() => {
                let opt = JSON.parse(JSON.stringify(options2));
                opt.url += '9999/forkCount'; // number required
                return server.inject(opt).then((response) => {
                    response.should.be.an('object').and.contain.keys('statusCode','payload');
                    response.statusCode.should.equal(404);
                    response.payload.should.be.a('string');
                    let payload = JSON.parse(response.payload);
                    payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                    payload.error.should.equal('Not Found');
                });
            });
        });  
    });   
        
    context('when getting the forkGroup of a deck', () => {
        it('it should reply all decks of the deck fork chain', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += deckID + '/forkGroup';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('array').and.have.length(3);
            });
        });
        it('it should return 404 if not an existing deck', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += '9999/forkGroup'; // number required
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(404);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                payload.error.should.equal('Not Found');
            });
        });  
    }); 
});