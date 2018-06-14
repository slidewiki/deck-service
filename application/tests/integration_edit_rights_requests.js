/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

chai.should();

describe('REST API edit rights requests', () => {

    const mockery = require('mockery');
    // mock user service
    mockery.registerMock('../services/user', {
        fetchUserInfo: () => {
            return Promise.reject('not mocking optional function');
        },
        fetchGroupInfo: () => {
            console.log('aaa');
            return Promise.reject('not mocking optional function');
        },
        fetchUsersForGroups: (groupIds) => {
            return Promise.resolve([groupEditorId]);
        }
    });
    // end mock

    // enable it
    mockery.enable({
        warnOnReplace: false,
        warnOnUnregistered: false,
    });

    let server, tokenFor;
 
    before(() => {
        // then load libraries
        const testServer = require('../testServer');
        tokenFor = testServer.tokenFor;

        return testServer.init().then((newServer) => {
            server = newServer;
            return server.start();
        });

    });

    after(() => {
        return Promise.resolve().then(() => {
            // disable mocking
            mockery.disable();
            return server && server.stop();
        });
    });


    let ownerId = 1, newEditorId = 2, editorId = 3, groupEditorId = 4;

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
                '----jwt----': tokenFor(ownerId),
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
                '----jwt----': tokenFor(newEditorId),
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
                '----jwt----': tokenFor(newEditorId),
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
            [tokenFor(ownerId), tokenFor(editorId), tokenFor(groupEditorId)]
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

        before(() => {
            return server.inject({
                method: 'POST',
                url: `/deck/${deckId}/requestEditRights`,
                headers: {
                    '----jwt----': tokenFor(someUserId),
                },
            })
            .then(() => server.inject({
                method: 'POST',
                url: `/deck/${deckId}/requestEditRights`,
                headers: {
                    '----jwt----': tokenFor(1111),
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
                        '----jwt----': tokenFor(ownerId),
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
                            '----jwt----': tokenFor(ownerId),
                        },
                    });
                });
            });

            it('should accept an edit rights request from the same user', () => {
                return server.inject({
                    method: 'POST',
                    url: `/deck/${deckId}/requestEditRights`,
                    headers: {
                        '----jwt----': tokenFor(someUserId),
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
