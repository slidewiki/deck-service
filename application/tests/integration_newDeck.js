/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

chai.should();

describe('REST API new deck', () => {

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


    const minimumDeckData = {
        title: 'new deck', // warning appears if no title is set, temporary fix
    };
    const fullDeckData = {
        description: 'dummy',
        language: 'en',
        translation: {
            status: 'original'
        },
        tags: [
            { 
                tagName: 'tagOne'
            },
            { 
                tagName: 'tagTwo'
            }
        ],
        title: 'new deck',
        root_deck: '1',
        parent_deck: {
            id: '1',
            revision: '1'
        },
        abstract: 'dummy',
        comment: 'dummy',
        footer: 'dummy',
        first_slide: {
            content: 'dummy',
            title: 'Dummy',
            speakernotes: 'dummy'
        },
        theme: 'default',
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
        },
        slideDimensions: { width: 800, height: 400 },
    };
    
    let authToken = JWT.sign( { userid: 1 }, secret );
    let authToken2 = JWT.sign( { userid: 2 }, secret );
    
    let options = {
        method: 'POST',
        url: '/deck/', // + 'new'
        headers: {
            'Content-Type': 'application/json',
            '----jwt----': '',
        }
    };
    let options2 = {
        method: 'GET',
        url: '/deck/',
        headers: {
            'Content-Type': 'application/json',
        }
    };         
    
    let deckID; // id of the newly created deck with full data
    
    context('when creating a deck', () => {
        it('it should reply it for minimum data', () => {
            let opt = JSON.parse(JSON.stringify(options));
            opt.payload = minimumDeckData;
            opt.headers['----jwt----'] = authToken;
            opt.url += 'new';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('user', 'timestamp', 'revisions', 'id', 'editors', 'license', 'contributors');
                payload.user.should.equal(1);
                payload.license.should.equal('CC BY-SA');
                payload.editors.should.be.an('object').and.contain.keys('users', 'groups');
                payload.editors.users.should.be.an('array').and.have.length(0);
                payload.editors.groups.should.be.an('array').and.have.length(0);
                payload.contributors.should.be.an('array').and.have.length(1);
                payload.contributors[0].should.be.an('object').and.contain.keys('user');
                payload.contributors[0].user.should.equal(1);
                //payload.contributors[0].count.should.equal(1); // 'count' not used

                payload.revisions.should.be.an('array').and.have.length(1);
                let revision = payload.revisions[0];
                revision.should.be.an('object').and.contain.keys('id', 'usage', 'timestamp', 'user', 'tags');
                revision.user.should.equal(1);
                revision.id.should.equal(1);
                revision.usage.should.be.an('array').and.have.length(0);
                revision.tags.should.be.an('array').and.have.length(0);
            });
        });
        it('it should reply it for full data', () => {
            let opt = JSON.parse(JSON.stringify(options));
            opt.payload = fullDeckData;
            opt.headers['----jwt----'] = authToken2;
            opt.url += 'new';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('user', 'timestamp', 'revisions', 'id', 'editors', 'license', 'contributors');
                payload.user.should.equal(2);
                deckID = String(payload.id);
                payload.license.should.equal('CC BY-SA');
                payload.editors.should.be.an('object').and.contain.keys('users', 'groups');
                payload.editors.users.should.be.an('array').and.have.length(2);
                payload.editors.groups.should.be.an('array').and.have.length(1);
                payload.contributors.should.be.an('array').and.have.length(1);
                payload.contributors[0].should.be.an('object').and.contain.keys('user');
                payload.contributors[0].user.should.equal(2);
                //payload.contributors[0].count.should.equal(1); // 'count' not used
                payload.should.have.a.nested.property('slideDimensions.width', 800);
                payload.should.have.a.nested.property('slideDimensions.height', 400);

                payload.revisions.should.be.an('array').and.have.length(1);
                let revision = payload.revisions[0];
                revision.should.be.an('object').and.contain.keys('id', 'usage', 'timestamp', 'user', 'tags');
                revision.user.should.equal(2);
                revision.id.should.equal(1);
                revision.usage.should.be.an('array').and.have.length(1);
                revision.tags.should.be.an('array').and.have.length(2);
            });
        });
        it('it should return 401 if JWT-login is wrong', () => {
            let opt = JSON.parse(JSON.stringify(options));
            opt.payload = {};
            opt.url += 'new';
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
    
    context('when getting metadata for a deck', () => {
        it('it should reply it', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += deckID;
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys(
                    '_id', 'user', 'timestamp', 'license', 'revisions', 'editors', 'contributors', 'revisionId', 'language'
                );
                payload._id.should.equal(parseInt(deckID));
                payload.user.should.equal(2);
                payload.license.should.equal('CC BY-SA');
                payload.revisionId.should.equal(1);
                payload.language.should.equal('en');
                payload.editors.should.be.an('object').and.contain.keys('users', 'groups');
                payload.editors.users.should.be.an('array').and.have.length(2);
                payload.editors.groups.should.be.an('array').and.have.length(1);
                payload.contributors.should.be.an('array').and.have.length(1);
                payload.contributors[0].should.be.an('object').and.contain.keys('user');
                payload.contributors[0].user.should.equal(2);
                //payload.contributors[0].count.should.equal(2); // 'count' not used
                payload.should.have.a.property('slideDimensions').that.is.an('object').and.contains.keys('width', 'height');

                payload.revisions.should.be.an('array').and.have.length(1);
                let revision = payload.revisions[0];
                revision.should.be.an('object').and.contain.keys('id', 'usage', 'timestamp', 'lastUpdate', 'user', 'tags');
                revision.user.should.equal(2);
                revision.id.should.equal(1);
                revision.usage.should.be.an('array').and.have.length(1);
                revision.tags.should.be.an('array').and.have.length(2);
            });
        });
        it('it should return 404 if no deck exists for given id', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += 'dummy'; // string works
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
    
    context('when appending a deck to a deck', () => { //TODO //TODO check if editors/contributors, datasources, etc change
        it('it should reply it', () => {
            let opt = JSON.parse(JSON.stringify(options));
            opt.url = '/decktree/node/create';
            opt.payload = {
                selector: {
                    id: deckID,
                    spath: '',
                },
                nodeSpec: {
                    type: 'deck',
                },
            };
            opt.headers['----jwt----'] = authToken2;
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('id', 'title', 'type', 'children');
            });
        });
        it('it should merge the slides and return them with /slides', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += deckID + '/slides';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('id', 'user', 'children', 'type');
                payload.user.should.equal('2');
                payload.type.should.equal('deck');
                payload.children.should.be.an('array').and.have.length(2);
            });
        });
        it('it should merge the slides and update slideCount', () => { // after appending decks /slides return 2 slides but count returns 1
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += deckID + '/slides?countOnly=true';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('slidesCount');
                payload.slidesCount.should.equal(2);
            });
        });
        it('it should return 400 if input is invalid', () => {
            let opt = JSON.parse(JSON.stringify(options));
            opt.payload = {};
            opt.url = '/decktree/node/create';
            opt.headers['----jwt----'] = authToken;
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(400);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                payload.error.should.equal('Bad Request');
            });
        });
        it('it should return 401 if JWT-login is wrong', () => {
            let opt = JSON.parse(JSON.stringify(options));
            opt.payload = {
                selector: {
                    id: deckID,
                    spath: '',
                },
                nodeSpec: {
                    type: 'deck',
                },
            };
            opt.url = '/decktree/node/create';
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
});