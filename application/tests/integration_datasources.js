/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

chai.should();

describe('REST API datasources', () => {

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


    let authToken = tokenFor(1);
    
    let options = {
        method: 'PUT',
        url: '/slide/', // + '{id}/datasources'
        headers: {
            'Content-Type': 'application/json',
            '----jwt----': '',
        }
    };
    let options2 = {
        method: 'GET',
        url: '/slide/', // + '{id}/datasources?countOnly={boolean}'
        headers: {
            'Content-Type': 'application/json',
        }
    };
    let options3 = {
        method: 'GET',
        url: '/deck/', // + '{id}/datasources?countOnly={boolean}'
        headers: {
            'Content-Type': 'application/json',
        }
    };
    
    let deckID; // id of the newly greated deck
    let slideID; // id of the newly greated slide
    
    context('when replacing the datasources of a slide', () => {  //BUG //TODO
        it('it should reply the new datasources', () => {
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
                payload.should.be.an('object').and.contain.keys('user', 'timestamp', 'id', 'license');
                payload.user.should.equal(1);
                deckID = String(payload.id);
                payload.license.should.equal('CC BY-SA');
                
                return server.inject({
                    method: 'POST',
                    url: '/slide/new',
                    payload: {
                        title: 'datsource slide',
                        content: 'dummy',
                        root_deck: deckID,
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
                    payload.should.be.an('object').and.contain.keys('user', 'timestamp', 'id', 'license');
                    payload.user.should.equal(1);
                    slideID = String(payload.id);
                    payload.license.should.equal('CC BY-SA');
                    /* //TODO append slide to deck
                    return server.inject({
                    method: 'PUT',
                    url: '/decktree/node/move',
                    payload: {
                      sourceSelector: {
                        id: slideID,
                        spath: '',
                        stype: 'slide',
                        //sid: 'string'
                      },
                      targetSelector: {
                        id: deckID,
                        spath: '',
                        stype: 'deck',
                        //sid: 'string'
                      },
                      targetIndex: 0
                    },
                    headers: {
                        'Content-Type': 'application/json',
                        '----jwt----': authToken,
                    },
                }).then((response) => {
                        console.log(response.payload);
                        response.should.be.an('object').and.contain.keys('statusCode','payload');
                        response.statusCode.should.equal(200);
                        response.payload.should.be.a('string');
                        let payload = JSON.parse(response.payload);
                        // TODO assertion
                        */
                    let opt = JSON.parse(JSON.stringify(options));
                    opt.payload = [{
                        type: 'book',
                        title: 'new book',
                        url: 'test.test/book',
                        comment: 'testing datasources',
                        authors: 'book writer',
                        year: '1999'
                    }];
                    opt.headers['----jwt----'] = authToken;
                    opt.url += slideID + '/datasources';
                    return server.inject(opt).then((response) => {
                        response.should.be.an('object').and.contain.keys('statusCode','payload');
                        response.statusCode.should.equal(200);
                        response.payload.should.be.a('string');
                        let payload = JSON.parse(response.payload);
                        payload.should.be.an('array').and.have.length(1);
                    });
                    //});
                });
            });
        });
        it('it should return 404 if not an existing slide', () => { // still get response with code 200
            let opt = JSON.parse(JSON.stringify(options));
            opt.payload = [{
                type: 'book',
                title: 'new book',
                url: 'test.test/book',
                comment: 'testing datasources',
                authors: 'book writer',
                year: '1999'
            }];
            opt.headers['----jwt----'] = authToken;
            opt.url += 'dummy/datasources'; // string works
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
            opt.payload = [{
                type: 'book',
                title: 'new book',
                url: 'test.test/book',
                comment: 'testing datasources',
                authors: 'book writer',
                year: '1999'
            }];
            opt.url += slideID + '/datasources';
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
            opt.url += slideID + '/datasources';
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
    
    context('when getting datasources of a slide', () => { //BUG //TODO
        it('it should reply them', () => { // returns empty but should have one source
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += slideID + '/datasources';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('items', 'totalCount', 'revisionOwner');
                payload.revisionOwner.should.equal(1);
            });
        });
        it('it should reply the count for countOnly', () => { // returns the same as countOnly=false
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += slideID + '/datasources?countOnly=true';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                // TODO assertion
            });
        });
        it('it should return 404 if no slide exists for given id', () => { // returns 500 - internal server error
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += 'dummy/datasources'; // number required?
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
    /* appending the slide has to work first, could also add datasources to auto-generated slide but getting doesnt work either way
    context('when getting datasources of a deck', () => { //BUG //TODO
        it('it should reply them', () => { // returns empty but should have one source
            let opt = JSON.parse(JSON.stringify(options3));
            opt.url += deckID + '/datasources';
            return server.inject(opt).then((response) => {
                console.log(response.payload);
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('items', 'totalCount', 'revisionOwner');
                payload.revisionOwner.should.equal(1);
            });
        });
        it('SLIDE TEST PLEASE DELETE AFTER SLIDE APPENDING WORKS', () => { // only for test output!
            let opt = JSON.parse(JSON.stringify(options3));
            opt.url += deckID + '/slides';
            return server.inject(opt).then((response) => {
                console.log(response.payload);
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
            });
        });
        it('it should reply the count for countOnly', () => { // returns the same as countOnly=false
            let opt = JSON.parse(JSON.stringify(options3));
            opt.url += deckID + '/datasources?countOnly=true';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                // TODO assertion
            });
        });
        it('it should return 404 if no deck exists for given id', () => {
            let opt = JSON.parse(JSON.stringify(options3));
            opt.url += 'dummy/datasources'; // number required?
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
    */
});