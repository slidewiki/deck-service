/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

chai.should();

describe('REST API editors', () => {

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
        title: 'new deck',
        editors: {
            groups: [
                {
                    id: '1',
                    joined: '1111-11-11'
                }
            ],
            users: [
                {
                    id: '3',
                    joined:'1111-11-11'
                },
                {
                    id: '4',
                    joined:'1111-11-11'
                }
            ]
        }
    };
    
    let authToken = tokenFor(1);
    
    let options = {
        method: 'GET',
        url: '/deck/', // + '{id}/editors', + '{id}/permissions' 
        headers: {
            'Content-Type': 'application/json',
        }
    };
    
    let options2 = {
        method: 'PUT',
        url: '/deck/', // + '{id}/editors' 
        headers: {
            'Content-Type': 'application/json',
            '----jwt----': '',
        }
    };
    
    let deckID; // id of the newly created deck
    
    context('when getting editors of a deck', () => {
        it('it should reply all contributors and editors', () => {
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
                payload.should.be.an('object').and.contain.keys('user', 'timestamp', 'editors', 'id', 'license');
                payload.user.should.equal(1);
                deckID = String(payload.id);
                payload.license.should.equal('CC BY-SA');
                payload.editors.should.be.an('object').and.contain.keys('users', 'groups');
                payload.editors.users.should.be.an('array').and.have.length(2);
                payload.editors.groups.should.be.an('array').and.have.length(1);
                payload.contributors.should.be.an('array').and.have.length(1);
                payload.contributors[0].should.be.an('object').and.contain.keys('user');
                payload.contributors[0].user.should.equal(1);
                //payload.contributors[0].count.should.equal(1); // 'count' not used
            }).then(() => {
                let opt = JSON.parse(JSON.stringify(options));
                opt.url += deckID + '/editors';
                return server.inject(opt).then((response) => {
                    response.should.be.an('object').and.contain.keys('statusCode','payload');
                    response.statusCode.should.equal(200);
                    response.payload.should.be.a('string');
                    let payload = JSON.parse(response.payload);
                    payload.should.be.an('object').and.contain.keys('editors');
                    payload.editors.should.be.an('object').and.contain.keys('users', 'groups');
                    payload.editors.users.should.be.an('array').and.have.length(2);
                    payload.editors.users[0].should.an('object').and.contain.keys('id', 'joined');
                    payload.editors.users[1].should.an('object').and.contain.keys('id', 'joined');
                    payload.editors.groups.should.be.an('array').and.have.length(1);
                    payload.editors.groups[0].should.an('object').and.contain.keys('id', 'joined');
                });
            });
        });
        it('it should return 404 if no deck exists for given id', () => {
            let opt = JSON.parse(JSON.stringify(options));
            opt.url += 'dummy/editors'; // string works
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
    
    context('when getting permissions of a user for a deck', () => {
        it('it should reply them', () => {
            let opt = JSON.parse(JSON.stringify(options));
            opt.headers['----jwt----'] = authToken;
            opt.url += deckID + '-1' + '/permissions';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('fork', 'edit', 'admin', 'readOnly');
                payload.fork.should.equal(true);
                payload.edit.should.equal(true);
                payload.admin.should.equal(true);
                payload.readOnly.should.equal(false);
            }).then(() => {
                let opt = JSON.parse(JSON.stringify(options));
                let authToken = tokenFor(3);
                opt.headers['----jwt----'] = authToken;
                opt.url += deckID + '-1' + '/permissions';
                return server.inject(opt).then((response) => {
                    response.should.be.an('object').and.contain.keys('statusCode','payload');
                    response.statusCode.should.equal(200);
                    response.payload.should.be.a('string');
                    let payload = JSON.parse(response.payload);
                    payload.should.be.an('object').and.contain.keys('fork', 'edit', 'admin', 'readOnly');
                    payload.fork.should.equal(false); // new decks are hidden by default, so no forking
                    payload.edit.should.equal(true);
                    payload.admin.should.equal(false);
                    payload.readOnly.should.equal(false);
                });
            }).then(() => {
                let opt = JSON.parse(JSON.stringify(options));
                let authToken = tokenFor(2);
                opt.headers['----jwt----'] = authToken;
                opt.url += deckID + '-1' + '/permissions';
                return server.inject(opt).then((response) => {
                    response.should.be.an('object').and.contain.keys('statusCode','payload');
                    response.statusCode.should.equal(200);
                    response.payload.should.be.a('string');
                    let payload = JSON.parse(response.payload);
                    payload.should.be.an('object').and.contain.keys('fork', 'edit', 'admin', 'readOnly');
                    payload.fork.should.equal(false);  // new decks are hidden by default, so no forking
                    payload.edit.should.equal(false);
                    payload.admin.should.equal(false);
                    payload.readOnly.should.equal(false);
                });
            });
        });
        it('it should return 404 if no deck exists for given id', () => {
            let opt = JSON.parse(JSON.stringify(options));
            opt.headers['----jwt----'] = authToken;
            opt.url += '999-999/permissions'; // only 'X-X' works where X is an integer
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
            opt.url += deckID + '/permissions'; // string works
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
    
    context('when replacing the editors of a deck', () => { //BUG //TODO
        it('it should reply the new editors', () => { // response empty, code 204
            let opt = JSON.parse(JSON.stringify(options2));
            opt.payload = {
                editors: {
                    groups: [],
                    users: [
                        {
                            id: '5',
                            joined:'1111-11-11'
                        }
                    ]
                }
            };
            opt.headers['----jwt----'] = authToken;
            opt.url += deckID + '/editors';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(204);
            });
        });
        it('it should return 404 if not an existing deck', () => { // might reply 200/204, internal server error
            let opt = JSON.parse(JSON.stringify(options2));
            opt.payload = {
                editors: {
                    groups: [],
                    users: []
                }
            };
            opt.headers['----jwt----'] = authToken;
            opt.url += 'dummy/editors'; // string works
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
            let opt = JSON.parse(JSON.stringify(options2));
            opt.payload = {
                editors: {
                    groups: [],
                    users: []
                }
            };
            opt.url += deckID + '/editors'; // string works
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
            let opt = JSON.parse(JSON.stringify(options2));
            opt.payload = {};
            opt.headers['----jwt----'] = authToken;
            opt.url += deckID + '/editors'; // string works
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