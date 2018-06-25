/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

chai.should();

describe('REST API tags', () => {

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
    
    let authToken = tokenFor(1);
    
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
            }).then(() => {
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
            opt.url += deckID + '/tags';
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
            opt.headers['----jwt----'] = authToken;
            opt.url += deckID + '/tags';
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