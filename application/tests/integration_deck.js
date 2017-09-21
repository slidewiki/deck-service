/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

describe('REST API', () => {

    const config = require('../configuration'),
		  // no jwt, for now
        //jwt = require('../controllers/jwt'),
        db = require('../database/helper');
    let server;
    //let jwtHeader, userid;
    
    before(() => { // TODO cleanDatabase
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
        return server.register(plugins, (err) => {
            if (err) {
                console.error(err);
                global.process.exit();
            } else {
                server.auth.strategy('jwt', 'jwt', {
                    key: 'dummy',
                    validateFunc: (decoded, request, callback) => {callback(null, true);},
                    verifyOptions: {
                        ignoreExpiration: true
                    }
                });
                
                //return db.cleanDatabase(config.MongoDB.SLIDEWIKIDATABASE).then(() => {
                    /*
                    let options = {
                        method: 'POST',
                        url: '/register',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        payload: fullData
                    };
                    return server.inject(options)
                        .then((response) => {
                            return server.inject({
                                method: 'GET',
                                url: '/user/activate/'+fullData.email+'/'+JSON.parse(response.payload).secret,
                                headers: {
                                    'Content-Type': 'application/json'
                                }
                            });
                    });
                }).then(() => {
                    let options = {
                        method: 'POST',
                        url: '/login',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        payload: {email: fullData.email, password: fullData.password}
                    };
                    return server.inject(options);
                }).then((response) => {
                    jwtHeader = response.headers['----jwt----'];
                    let payload = JSON.parse(response.payload);
                    userid = payload.userid;
                */
                //});
                return server.start(() => {
                    server.log('info', 'Server started at ' + server.info.uri);
                    require('../routes.js')(server);
                });
            }
        });
    });

    const minimumDeckData = {
        user: '1',
        title: ' ', // warning appears if no title is set, temporary fix
        license: 'CC0'
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
        title: 'Dummy',
        user: '2',
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
        license: 'CC0',
        theme: 'dummy',
        editors: {
            groups: [
              {
                id: "1",
                joined: "1111-11-11"
              }
            ],
            users: [
              {
                id: "3",
                joined:"1111-11-11"
              },
              {
                id: "4",
                joined:"1111-11-11"
              }
            ]
        }
    };
    
    let options = {
        method: 'POST',
        url: '/deck/', // + 'new'
        headers: {
            'Content-Type': 'application/json'
        }
    };
    let options2 = {
        method: 'GET',
        url: '/deck/', // + '{id}', + '{id}/forks?user={id}', + '{id}/forkCount?user={id}', + '{id}/editors'
                       // + '{id}/revisions', + '{id}/revisionCount', + '{id}/slides?limit={string}'
                       // + '{id}/slideCount'
        headers: {
            'Content-Type': 'application/json'
        }
    };   
    let options3 = {
        method: 'PUT',
        url: '/deck/', // + '{id}/fork', '{id}/tags'
        headers: {
            'Content-Type': 'application/json'
        }
    };        
    
    context('when creating a deck', () => {
        it('it should reply it for minimum data', () => {
            options.payload = minimumDeckData;
            let opt = JSON.parse(JSON.stringify(options));
            opt.url += 'new';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('user', 'timestamp', 'lastUpdate', 'revisions', 'id', 'editors', 'license', 'contributors');
                payload.user.should.equal(1);
                payload.id.should.equal(1);
                payload.license.should.equal('CC0');
                payload.editors.should.be.an('object').and.contain.keys('users', 'groups');
                payload.editors.users.should.be.an('array').and.have.length(0);
                payload.editors.groups.should.be.an('array').and.have.length(0);
                payload.contributors.should.be.an('array').and.have.length(1);
                payload.contributors[0].should.be.an('object').and.contain.keys('user'); // 'count' not used
                payload.contributors[0].user.should.equal(1);
                //payload.contributors[0].count.should.equal(1);
                payload.revisions.should.be.an('array').and.have.length(1);
                let revision = payload.revisions[0];
                revision.should.be.an('object').and.contain.keys('id', 'usage', 'timestamp', 'lastUpdate', 'user', 'tags');
                revision.user.should.equal(1);
                revision.id.should.equal(1);
                revision.usage.should.be.an('array').and.have.length(0);
                revision.tags.should.be.an('array').and.have.length(0);
            });
        });
        it('it should reply it for full data', () => {
            options.payload = fullDeckData;
            let opt = JSON.parse(JSON.stringify(options));
            opt.url += 'new';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('user', 'timestamp', 'lastUpdate', 'revisions', 'id', 'editors', 'license', 'contributors');
                payload.user.should.equal(2);
                payload.id.should.equal(2);
                payload.license.should.equal('CC0');
                payload.editors.should.be.an('object').and.contain.keys('users', 'groups');
                payload.editors.users.should.be.an('array').and.have.length(2);
                payload.editors.groups.should.be.an('array').and.have.length(1);
                payload.contributors.should.be.an('array').and.have.length(1);
                payload.contributors[0].should.be.an('object').and.contain.keys('user'); // 'count' not used
                payload.contributors[0].user.should.equal(2);
                //payload.contributors[0].count.should.equal(1);
                payload.revisions.should.be.an('array').and.have.length(1);
                let revision = payload.revisions[0];
                revision.should.be.an('object').and.contain.keys('id', 'usage', 'timestamp', 'lastUpdate', 'user', 'tags');
                revision.user.should.equal(2);
                revision.id.should.equal(1);
                revision.usage.should.be.an('array').and.have.length(1);
                revision.tags.should.be.an('array').and.have.length(2);;
            });
        });
        it('it should return 400 if required input is missing', () => {
            options.payload = {};
            let opt = JSON.parse(JSON.stringify(options));
            opt.url += 'new';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(400);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                payload.error.should.equal('Bad Request');
            })
        });
    });
    
    context('when getting metadata for a deck', () => {
        it('it should reply it', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += '2';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('_id', 'user', 'timestamp', 'lastUpdate', 'license', 'revisions', 'editors', 'contributors',
                                                               'latestRevisionId', 'revisionId', 'language');
                payload._id.should.equal(2);
                payload.user.should.equal(2);
                payload.license.should.equal('CC0');
                payload.latestRevisionId.should.equal(1);
                payload.revisionId.should.equal(1);
                payload.language.should.equal('en');
                payload.editors.should.be.an('object').and.contain.keys('users', 'groups');
                payload.editors.users.should.be.an('array').and.have.length(2);
                payload.editors.groups.should.be.an('array').and.have.length(1);
                payload.contributors.should.be.an('array').and.have.length(1);
                payload.contributors[0].should.be.an('object').and.contain.keys('user'); // 'count' not used
                payload.contributors[0].user.should.equal(2);
                //payload.contributors[0].count.should.equal(2);
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
    
    context('when replacing the tags of a deck', () => {
        it('it should reply the deck with replaced tags', () => {
            options3.payload = [
                {
                    tagName: 'replacedTag'
                }
            ];
            let opt = JSON.parse(JSON.stringify(options3));
            opt.url += '2/tags';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('_id', 'user', 'timestamp', 'lastUpdate', 'license', 'revisions');
                payload.revisions.should.be.an('array').and.have.length(1);
                let revision = payload.revisions[0];
                revision.should.be.an('object').and.contain.keys('id', 'usage', 'timestamp', 'lastUpdate', 'user', 'tags');
                revision.user.should.equal(2);
                revision.id.should.equal(1);
                revision.usage.should.be.an('array').and.have.length(1);
                revision.tags.should.be.an('array').and.have.length(1);
                revision.tags[0].should.be.an('object').and.contain.keys('tagName');
                revision.tags[0].tagName.should.equal('replacedTag');
            })
        });
        it('it should return 404 if not an existing deck', () => {
            options3.payload = [];
            let opt = JSON.parse(JSON.stringify(options3));
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
    });  
    
    context('when creating a fork for a deck', () => {
        it('it should reply the new root deck and id map', () => {
            options3.payload = {
                user: '1'
            };
            let opt = JSON.parse(JSON.stringify(options3));
            opt.url += '2/fork';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('root_deck', 'id_map');
                payload.root_deck.should.be.a('string').and.equal('3-1');
                payload.id_map.should.be.an('object').and.contain.keys('2-1');
                payload.id_map['2-1'].should.be.a('string').and.equal('3-1');
            }).then((response) => {
                options3.payload = {
                    user: '2'
                };
                let opt = JSON.parse(JSON.stringify(options3));
                opt.url += '2/fork';
                return server.inject(opt).then((response) => {
                    response.should.be.an('object').and.contain.keys('statusCode','payload');
                    response.statusCode.should.equal(200);
                    response.payload.should.be.a('string');
                    let payload = JSON.parse(response.payload);
                    payload.should.be.an('object').and.contain.keys('root_deck', 'id_map');
                    payload.root_deck.should.be.a('string').and.equal('4-1');
                    payload.id_map.should.be.an('object').and.contain.keys('2-1');
                    payload.id_map['2-1'].should.be.a('string').and.equal('4-1');
                })
            });
        });
        it('it should return 403 if not a valid deck to fork from', () => { // QUESTION why not 404?
            options3.payload = {
                    user: '1'
            };
            let opt = JSON.parse(JSON.stringify(options3));
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
        it('it should return 400 if required input is missing', () => {
            options3.payload = {};
            let opt = JSON.parse(JSON.stringify(options3));
            opt.url += '2/fork';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(400);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                payload.error.should.equal('Bad Request');
            })
        });
    });
    
    context('when getting the forks and the fork count for a deck', () => {
        it('it should reply all forks', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += '2/forks';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('array').and.have.length(2);
                payload[0].should.be.an('object').and.contain.keys('id', 'user', 'timestamp', 'lastUpdate', 'origin');
                payload[0].id.should.equal(3);
                payload[0].user.should.equal(1);
                payload[1].should.be.an('object').and.contain.keys('id', 'user', 'timestamp', 'lastUpdate', 'origin');
                payload[1].id.should.equal(4);
                payload[1].user.should.equal(2);
            });
        });
        it('it should reply all forks for a user', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += '2/forks?user=1';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('array').and.have.length(1);
                payload[0].should.be.an('object').and.contain.keys('id', 'user', 'timestamp', 'lastUpdate', 'origin');
                payload[0].id.should.equal(3);
                payload[0].user.should.equal(1);
            });
        });
        it('it should reply the correct count of forks', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += '2/forkCount';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string').and.equal('2');
            });
        });
        it('it should reply the correct count of forks for a user', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += '2/forkCount?user=1';
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
            }).then((response) => {
                let opt = JSON.parse(JSON.stringify(options2));
                opt.url += '9999/forkCount'; // number required
                return server.inject(opt).then((response) => {
                    response.should.be.an('object').and.contain.keys('statusCode','payload');
                    response.statusCode.should.equal(404);
                    response.payload.should.be.a('string');
                    let payload = JSON.parse(response.payload);
                    payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                    payload.error.should.equal('Not Found');;
                })
            });
        });  
    });    
    
    context('when getting editors of a deck', () => {
        it('it should reply all contributors and editors', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += '2/editors';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('contributors', 'editors');
                payload.contributors.should.be.an('array').and.have.length(2);
                payload.contributors[0].should.be.an('object').and.contain.keys('id');
                payload.contributors[0].id.should.equal(2);
                payload.contributors[1].should.be.an('object').and.contain.keys('id');
                payload.contributors[1].id.should.equal(-1);               
                payload.editors.should.be.an('object').and.contain.keys('users', 'groups');
                payload.editors.users.should.be.an('array').and.have.length(2);
                payload.editors.users[0].should.an('object').and.contain.keys('id', 'joined');
                payload.editors.users[1].should.an('object').and.contain.keys('id', 'joined');
                payload.editors.groups.should.be.an('array').and.have.length(1);
                payload.editors.groups[0].should.an('object').and.contain.keys('id', 'joined');
            });
        });
        it('it should return 404 if no deck exists for given id', () => {
            let opt = JSON.parse(JSON.stringify(options2));
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
  
    context('when getting the revisions and the revision count for a deck', () => {
        it('it should reply all revisions', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += '2/revisions';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('array').and.have.length(2);
                payload[0].should.be.an('object').and.contain.keys('id', 'user', 'timestamp', 'lastUpdate');
                payload[0].id.should.equal(2);
                payload[0].user.should.equal(-1);
                payload[1].should.be.an('object').and.contain.keys('id', 'user', 'timestamp', 'lastUpdate');
                payload[1].id.should.equal(1);
                payload[1].user.should.equal(2);
            });
        });
        it('it should reply the correct count of revisions', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += '2/revisionCount';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string').and.equal('2');
            });
        });
        it('it should return 404 if not an existing deck', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += '9999/revisions'; // number required
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(404);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                payload.error.should.equal('Not Found');
            }).then((response) => {
                let opt = JSON.parse(JSON.stringify(options2));
                opt.url += 'dummy/revisionCount'; // string works
                return server.inject(opt).then((response) => {
                    response.should.be.an('object').and.contain.keys('statusCode','payload');
                    response.statusCode.should.equal(404);
                    response.payload.should.be.a('string');
                    let payload = JSON.parse(response.payload);
                    payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                    payload.error.should.equal('Not Found');;
                })
            });
        });  
    });
  
    context('when getting the slides and the slide count for a deck', () => {
        it('it should reply all slides', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += '2/slides';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('id', 'user', 'children');
                payload.id.should.equal('2');
                payload.user.should.equal('-1');
                payload.children.should.be.an('array').and.have.length(1);
                payload.children[0].should.be.an('object').and.contain.keys('id', 'user');
                payload.children[0].id.should.equal('2-1');
                payload.children[0].user.should.equal('2');
            });
        });
        it('it should reply limited slides if limit is set', () => { // QUESTION why are limit and offset strings?
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += '2/slides?limit=0';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('id', 'user', 'children');
                payload.id.should.equal('2');
                payload.user.should.equal('-1');
                payload.children.should.be.an('array').and.have.length(0);
            });
        });
        it('it should reply the correct count of slides', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += '2/slideCount';
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(200);
                response.payload.should.be.a('string').and.equal('1');
            });
        });
        it('it should return 404 if not an existing deck', () => {
            let opt = JSON.parse(JSON.stringify(options2));
            opt.url += 'dummy/slides'; // string works
            return server.inject(opt).then((response) => {
                response.should.be.an('object').and.contain.keys('statusCode','payload');
                response.statusCode.should.equal(404);
                response.payload.should.be.a('string');
                let payload = JSON.parse(response.payload);
                payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                payload.error.should.equal('Not Found');
            }).then((response) => {
                let opt = JSON.parse(JSON.stringify(options2));
                opt.url += 'dummy/slideCount'; // string works
                return server.inject(opt).then((response) => {
                    response.should.be.an('object').and.contain.keys('statusCode','payload');
                    response.statusCode.should.equal(404);
                    response.payload.should.be.a('string');
                    let payload = JSON.parse(response.payload);
                    payload.should.be.an('object').and.contain.keys('statusCode', 'error');
                    payload.error.should.equal('Not Found');;
                })
            });
        });  
    });
});