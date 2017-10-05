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
        title: 'new deck',
        root_deck: '1',
        parent_deck: {
            id: '1',
            revision: '1'
        },
    };
    
    let authToken = JWT.sign( { userid: 1 }, secret );
    
    let options = {
        method: 'GET',
        url: '/deck/', // + '{id}/usage', + '{id}/rootDecks', + '{id}/deepUsage', + '{id}/dataSources'
        headers: {
            'Content-Type': 'application/json',
        }
    };
    
    let deckID; // id of the newly created deck
    
    context('when getting usage for a deck', () => { //TODO
        it('it should reply the parent decks', () => { // response is empty array
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
                revision.should.be.an('object').and.contain.keys('id', 'usage', 'timestamp', 'user');
                revision.user.should.equal(1);
                revision.id.should.equal(1);
                revision.usage.should.be.an('array').and.have.length(1);
            }).then(() => {
                let opt = JSON.parse(JSON.stringify(options));
                opt.url += deckID + '/usage';
                return server.inject(opt).then((response) => {
                    response.should.be.an('object').and.contain.keys('statusCode','payload');
                    response.statusCode.should.equal(200);
                    response.payload.should.be.a('string');
                    let payload = JSON.parse(response.payload);
                    payload.should.be.an('array').and.have.length(0);
                });
            });
        });
        it('it should return 404 if no deck exists for given id', () => {
            let opt = JSON.parse(JSON.stringify(options));
            opt.url += '999/usage'; // number required?
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
    
    context('when getting root parent decks of a deck', () => {
        it('it should reply them', () => {
            let opt = JSON.parse(JSON.stringify(options));
            opt.url += deckID + '/rootDecks';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('array').and.have.length(1);
            });
        });
        it('it should return 404 if no deck exists for given id', () => {
            let opt = JSON.parse(JSON.stringify(options));
            opt.url += '999/rootDecks'; // number required?
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
    
    context('when getting deep usage of a deck', () => { //TODO Fix test - deepUsage returns decks that point directly or indirectly to the specified deck
        it('it should reply it', () => { // response is empty array
            let opt = JSON.parse(JSON.stringify(options));
            opt.url += '1' + '/deepUsage'; // TODO maybe choose other id
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                // console.log(payload);
                payload.should.be.an('array').and.have.length(0);
            });
        });
        it('it should return 404 if no deck exists for given id', () => { // still get same response with code 200
            let opt = JSON.parse(JSON.stringify(options));
            opt.url += '999/deepUsage'; // number required?
            return server.inject(opt).then((response) => {
                // console.log(response.payload);
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