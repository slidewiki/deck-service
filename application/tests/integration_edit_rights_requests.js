/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

describe('REST API for edit rights requests', () => {
    const mockery = require('mockery');

    const JWT = require('jsonwebtoken');
    const secret = 'NeverShareYourSecret';

    let server;

    before((done) => {
        // mock user service
        mockery.enable({
            warnOnReplace: false,
            warnOnUnregistered: false,
        });
        mockery.registerMock('../services/user', {
            fetchUserInfo: () => {
                return Promise.reject('not mocking optional function');
            },
            fetchGroupInfo: () => {
                return Promise.reject('not mocking optional function');
            },
            fetchUsersForGroups: (groupIds) => {
                return Promise.resolve([groupEditorId]);
            }
        });
        // end mock

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
                
                // const db = require('../database/helper');
                // db.cleanDatabase();

                server.start(() => {
                    server.log('info', 'Server started at ' + server.info.uri);
                    require('../routes.js')(server);
                    done();
                });
            }
        });
    });

    // disable mocking
    after(() => {
        mockery.disable();
    });

    let ownerId = 1, newEditorId = 2, editorId = 3, groupEditorId = 4;

    let ownerToken = JWT.sign( { userid: ownerId }, secret );
    let newEditorToken = JWT.sign( { userid: newEditorId }, secret );
    let editorToken = JWT.sign( { userid: editorId }, secret );
    let groupEditorToken = JWT.sign( { userid: groupEditorId }, secret );

    let deckId;

    // create deck to test on using creator id
    before(() => {
        return server.inject({
            method: 'POST',
            url: '/deck/new',
            payload: {
                title: 'A deck that some user wants to edit',
                editors: {
                    users: [{ id: editorId, joined:'2011-11-11'}],
                    groups: [{ id: 2, joined: '2011-11-11' }],
                },
            },
            headers: {
                'Content-Type': 'application/json',
                '----jwt----': ownerToken,
            },
        }).then((response) => {
            // grab the id!
            let payload = JSON.parse(response.payload);
            deckId = String(payload.id);
            return response;
        });
    });

    it('should accept as such a new request for edit rights for some user', () => {
        return server.inject({
            method: 'POST',
            url: `/deck/${deckId}/requestEditRights`,
            headers: {
                '----jwt----': newEditorToken,
            },
        }).then((response) => {
            response.should.have.property('statusCode', 200);
            let payload = JSON.parse(response.payload);
            payload.should.have.property('user', newEditorId);
            payload.should.have.property('isNew', true);
        });
    });

    it('should accept as not new a duplicate request for edit rights for some user', () => {
        return server.inject({
            method: 'POST',
            url: `/deck/${deckId}/requestEditRights`,
            headers: {
                '----jwt----': newEditorToken,
            },
        }).then((response) => {
            response.should.have.property('statusCode', 200);
            let payload = JSON.parse(response.payload);
            payload.should.have.property('user', newEditorId);
            payload.should.have.property('isNew', false);
        });
    });

    it('should not accept a request for edit rights for a user already authorized', () => {
        return Promise.all(
            [ownerToken, editorToken, groupEditorToken]
            .map((token) => server.inject({
                method: 'POST',
                url: `/deck/${deckId}/requestEditRights`,
                headers: { '----jwt----': token, },
            }).then((response) => {
                response.should.have.property('statusCode', 422);
            }))
        );
    });

    context('when a edit rights request is granted for some user', () => {
        let someUserId = 666;
        let someUserToken = JWT.sign( { userid: someUserId }, secret );

        before(() => {
            return server.inject({
                method: 'POST',
                url: `/deck/${deckId}/requestEditRights`,
                headers: {
                    '----jwt----': someUserToken,
                },
            })
            .then(() => server.inject({
                method: 'POST',
                url: `/deck/${deckId}/requestEditRights`,
                headers: {
                    '----jwt----': JWT.sign( { userid: 1111 }, secret ),
                },
            }))
            .then(() => server.inject({
                method: 'GET',
                url: `/deck/${deckId}/editors`,
            }))
            .then(({payload}) => {
                let {editors} = JSON.parse(payload);
                editors.users.push({id: someUserId, joined: new Date().toISOString()});
                return server.inject({
                    method: 'PUT',
                    url: `/deck/${deckId}/editors`,
                    payload: {editors},
                    headers: {
                        '----jwt----': ownerToken,
                    },
                });
            });
        });

        context('and then that user is removed from editors', () => {

            before(() => {
                return server.inject({
                    method: 'GET',
                    url: `/deck/${deckId}/editors`,
                }).then(({payload}) => {
                    let {editors} = JSON.parse(payload);
                    editors.users = editors.users.filter((u) => u.id !== someUserId);
                    return server.inject({
                        method: 'PUT',
                        url: `/deck/${deckId}/editors`,
                        payload: {editors},
                        headers: {
                            '----jwt----': ownerToken,
                        },
                    });
                });
            });

            it('should accept an edit rights request from the same user', () => {
                return server.inject({
                    method: 'POST',
                    url: `/deck/${deckId}/requestEditRights`,
                    headers: {
                        '----jwt----': someUserToken,
                    },
                }).then((response) => {
                    response.should.have.property('statusCode', 200);
                    let payload = JSON.parse(response.payload);
                    payload.should.have.property('user', someUserId);
                    payload.should.have.property('isNew', true);
                });
            });

        });

    });

});
