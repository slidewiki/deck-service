'use strict';

let chai = require('chai');
let chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

let should = chai.should();

let helper = require('../database/helper.js');
let slideDB = require('../database/slideDatabase');
let deckDB = require('../database/deckDatabase');

describe('deckDatabase', function() {

    beforeEach(function(done) {
        helper.cleanDatabase().then(() => {
            helper.connectToDatabase().then((db) => {
                helper.applyFixtures(db, require('./fixtures/decktree-editors.json'), done);
            });
        });
    });

    describe('#needsNewRevision()', function() {

        it('should always allow edit without new revision for owner', function() {
            return Promise.all([
                deckDB.needsNewRevision('54-12', 46)
                .then((needs) => {
                    needs.should.have.property('needs_revision', false);
                }),
                deckDB.update('54-12', { accessLevel: 'private' } ).then(() => deckDB.needsNewRevision('54-12', 46))
                .then((needs) => {
                    needs.should.have.property('needs_revision', false);
                }),
                deckDB.update('54-12', { accessLevel: 'restricted' } ).then(() => deckDB.needsNewRevision('54-12', 46))
                .then((needs) => {
                    needs.should.have.property('needs_revision', false);
                }),
            ]);

        });

        context('for a public or restricted deck', function() {

            it('should allow edit without new revision for user who\'s already contributed', function() {
                return Promise.all([
                    deckDB.needsNewRevision('54-12', 3)
                    .then((needs) => {
                        needs.should.have.property('needs_revision', false);
                    }),
                    deckDB.update('54-12', { accessLevel: 'restricted' } ).then(() => deckDB.needsNewRevision('54-12', 3))
                    .then((needs) => {
                        needs.should.have.property('needs_revision', false);
                    }),
                ]);
            });

        });

        context('for a restricted deck', function() {
            it('should allow edit without new revision for user explicitly in deck editors', function() {
                return deckDB.update('54-12', {
                    accessLevel: 'restricted',
                    editors: {
                        users: [
                        { id: 4, },
                        { id: 5, },
                        ],
                        groups: [
                        { id: 2, }
                        ]
                    },
                })
                .then((updated) => deckDB.needsNewRevision('54-12', 4))
                .then((needs) => {
                    needs.should.have.property('needs_revision', false);
                });

            });

            // TODO properly setup a test for this, needs a mock for the user service
            it.skip('should allow edit without new revision for user explicitly in deck groups', function() {
                return deckDB.update('54-12', {
                    accessLevel: 'restricted',
                    editors: {
                        users: [
                        { id: 4, },
                        { id: 5, },
                        ],
                        groups: [
                        { id: 2, }
                        ]
                    },
                })
                .then((updated) => deckDB.needsNewRevision('54-12', 6))
                .then((needs) => {
                    needs.should.have.property('needs_revision', false);
                });

            });

        });

    });

    describe('#getDeckUsersGroups()', function() {

        it('should include all contributors to the deck when accessLevel is not private', function() {
            // update first to private and recalculate
            return deckDB.update('54-12', { accessLevel: 'public' })
            .then((updated) => deckDB.getDeckUsersGroups('54-12'))
            .then((editors) => {
                editors.users.should.have.members([ 9, 46, 26, 10, 3 ]);
            });

        });

        it('should return only the deck revision owner when accessLevel is private', function() {
            // update first to private and recalculate
            return deckDB.update('54-12', { accessLevel: 'private' })
            .then((updated) => deckDB.getDeckUsersGroups('54-12'))
            .then((editors) => {
                editors.users.should.have.members([ 46 ]);
            });

        });

        it('should also include any additional editors when accessLevel is restricted', function() {
            // update first to private and recalculate
            return deckDB.update('54-12', {
                accessLevel: 'restricted',
                editors: {
                    users: [
                    { id: 4, },
                    { id: 5, },
                    ],
                    groups: [
                    { id: 2, }
                    ]
                },
            })
            .then((updated) => deckDB.getDeckUsersGroups('54-12'))
            .then((editors) => {
                editors.groups.should.have.members([ 2 ]);
                editors.users.should.have.members([ 9, 46, 26, 10, 3, 4, 5 ]);
            });
        });

    });

});
