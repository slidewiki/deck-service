/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

chai.should();

describe('REST API usage deck', () => {

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


    let parentId;
    before(() => {
        return server.inject({
            method: 'POST',
            url: '/deck/new',
            payload: { title: 'parent deck' },
            headers: {
                'Content-Type': 'application/json',
                '----jwt----': authToken,
            },
        }).then((response) => {
            // grab the id!
            let payload = JSON.parse(response.payload);
            parentId = String(payload.id);
            return response;
        });
    });
    
    let authToken = tokenFor(1);
    
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
                payload: {
                    title: 'new deck',
                    root_deck: parentId,
                    parent_deck: {
                        id: parentId,
                        revision: '1'
                    },
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