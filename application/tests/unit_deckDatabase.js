/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

let chai = require('chai');
let chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

chai.should();

let helper = require('../database/helper.js');
let deckDB = require('../database/deckDatabase');

describe('deckDatabase', function() {

    beforeEach(function() {
        return helper.cleanDatabase().then(() =>
            helper.connectToDatabase().then((db) =>
                helper.applyFixtures(db, require('./fixtures/decktree-editors.json'))
            )
        );
    });

    // TODO any tests involving restricted / private decks are commented out/skipped until feature is enabled

    describe('#forkAllowed()', function() {

        it('should return true for the deck owner regardless of access level', function() {
            let userId = 46;
            return Promise.all([
                deckDB.forkAllowed('54', userId)
                .then((forkAllowed) => {
                    forkAllowed.should.equal(true);
                }),
                deckDB._adminUpdate('54', { accessLevel: 'private' })
                .then(() => deckDB.forkAllowed('54', userId))
                .then((forkAllowed) => {
                    forkAllowed.should.equal(true);
                }),
                deckDB._adminUpdate('54', { accessLevel: 'restricted' })
                .then(() => deckDB.forkAllowed('54', userId))
                .then((forkAllowed) => {
                    forkAllowed.should.equal(true);
                }),
            ]);
        });

        it('should return true for all public decks regardless of the user', function() {
            let someUserId = 666;
            return deckDB.forkAllowed('54', someUserId)
            .then((forkAllowed) => {
                forkAllowed.should.equal(true);
            });

        });

        context.skip('if the deck is private', function() {
            beforeEach(function() {
                return deckDB._adminUpdate('54', { accessLevel: 'private' });
            });

            it('should return false for some unauthorized user', function() {
                let someUserId = 666;
                return deckDB.forkAllowed('54', someUserId)
                .then((forkAllowed) => {
                    forkAllowed.should.equal(false);
                });

            });

        });

        context.skip('if the deck is restricted', function() {
            beforeEach(function() {
                return deckDB._adminUpdate('54', { accessLevel: 'restricted' });
            });

            it('should return true for some unauthorized user', function() {
                let someUserId = 666;
                return deckDB.forkAllowed('54', someUserId)
                .then((forkAllowed) => {
                    forkAllowed.should.equal(true);
                });

            });

            it('should return true for a contributor that is not explicitly authorized', function() {
                return deckDB.forkAllowed('54', 3)
                .then((forkAllowed) => {
                    forkAllowed.should.equal(true);
                });

            });

            it('should return true for a user explicitly authorized', function() {
                return deckDB.forkAllowed('54', 4)
                .then((forkAllowed) => {
                    forkAllowed.should.equal(true);
                });

            });

            // TODO properly setup a test for this, needs a mock for the user service
            it.skip('should return true for a user explicitly authorized via groups', function() {
                return deckDB.forkAllowed('54', 6)
                .then((forkAllowed) => {
                    forkAllowed.should.equal(true);
                });

            });

        });

    });

    describe('#getDeckUsersGroups()', function() {

        it.skip('should only include the owner and no groups for decks that are private', function() {
            // update first to private and recalculate
            return deckDB._adminUpdate('54', { accessLevel: 'private' })
            .then(() => deckDB.getDeckUsersGroups('54'))
            .then((editors) => {
                editors.users.should.have.members([ 46 ]);
                editors.groups.should.be.empty;
            });

        });

        it.skip('should exactly include all explicitly authorized users and authorized groups for restricted decks', function() {
            // update first to restricted and recalculate
            return deckDB._adminUpdate('54', { accessLevel: 'restricted' })
            .then(() => deckDB.getDeckUsersGroups('54'))
            .then((editors) => {
                editors.users.should.have.members([ 4, 5 ]);
                editors.groups.should.have.members([ 2 ]);
            });
        });

        it('should exactly include all explicitly authorized users and authorized groups for public decks', function() {
            return deckDB.getDeckUsersGroups('54')
            .then((editors) => {
                editors.users.should.have.members([ 4, 5 ]);
                editors.groups.should.have.members([ 2 ]);
            });
        });

    });

    describe('#userPermissions()', function() {

        it('should allow edit for the deck owner regardless of access level', function() {
            let userId = 46;
            return Promise.all([
                deckDB.userPermissions('54', userId)
                .then((perms) => {
                    perms.should.have.property('edit', true);
                }),
            ]);
        });

        context('if the deck is public', function() {

            it('should not allow edit for some unauthorized user', function() {
                let someUserId = 666;
                return deckDB.userPermissions('54', someUserId)
                .then((perms) => {
                    perms.should.have.property('edit', false);
                });

            });

            it('should not allow edit for a contributor that is not explicitly authorized', function() {
                return deckDB.userPermissions('54', 3)
                .then((perms) => {
                    perms.should.have.property('edit', false);
                });

            });

            it('should allow edit for a user explicitly authorized', function() {
                return deckDB.userPermissions('54', 4)
                .then((perms) => {
                    perms.should.have.property('edit', true);
                });

            });

            // TODO properly setup a test for this, needs a mock for the user service
            it.skip('should allow edit for a user explicitly authorized via groups', function() {
                return deckDB.userPermissions('54', 6)
                .then((perms) => {
                    perms.should.have.property('edit', true);
                });

            });

        });

    });

    describe('#adminAllowed()', function() {

        it('should return true for the deck owner', function() {
            let userId = 46;
            return Promise.all([
                deckDB.adminAllowed('54', userId)
                .then((allowed) => {
                    allowed.should.equal(true);
                }),
            ]);
        });

        it('should return false for some unauthorized user', function() {
            let someUserId = 666;
            return deckDB.adminAllowed('54', someUserId)
            .then((allowed) => {
                allowed.should.equal(false);
            });

        });

        it('should return false for a contributor that is not explicitly authorized', function() {
            return deckDB.adminAllowed('54', 3)
            .then((allowed) => {
                allowed.should.equal(false);
            });

        });

        it('should return false for a user explicitly authorized', function() {
            return deckDB.adminAllowed('54', 4)
            .then((allowed) => {
                allowed.should.equal(false);
            });

        });

        // TODO properly setup a test for this, needs a mock for the user service
        it.skip('should return false for a user explicitly authorized via groups', function() {
            return deckDB.adminAllowed('54', 6)
            .then((allowed) => {
                allowed.should.equal(false);
            });

        });

    });

    describe('#getSubdeckIds', function() {
        it('should return all the subdecks under a root deck', function() {
            return deckDB.getSubdeckIds('54')
            .then((subdeckIds) => {
                subdeckIds.should.have.members([ 54, 55, 91, 92, 101, 56, 57 ]);
            });

        });

    });

    describe('#getPicturesPerDeck', function() {
        it('should return all images found in deck\'s and its subdecks\' slides', function() {
            return deckDB.getMedia('54', 'pictures')
            .then((pictures) => {
                pictures.should.have.members([
                    'http://fileservice.experimental.slidewiki.org/5/ddc9a830-bba4-11e6-9bdb-395cce787fb5.png',
                    'http://fileservice.experimental.slidewiki.org/5/ddfc02d0-bba4-11e6-9bdb-395cce787fb5.png',
                    'http://fileservice.experimental.slidewiki.org/5/ddfc7800-bba4-11e6-9bdb-395cce787fb5.png',
                    'http://fileservice.experimental.slidewiki.org/5/ddfd1440-bba4-11e6-9bdb-395cce787fb5.png',
                    'http://fileservice.experimental.slidewiki.org/5/ddfdb080-bba4-11e6-9bdb-395cce787fb5.png',
                    'http://fileservice.experimental.slidewiki.org/5/ddfe4cc0-bba4-11e6-9bdb-395cce787fb5.png',
                    'http://fileservice.experimental.slidewiki.org/5/ddff1010-bba4-11e6-9bdb-395cce787fb5.png',
                    'http://fileservice.experimental.slidewiki.org/5/de0f8ad0-bba4-11e6-9bdb-395cce787fb5.png',
                    'http://fileservice.experimental.slidewiki.org/5/de107530-bba4-11e6-9bdb-395cce787fb5.png',
                    'http://fileservice.experimental.slidewiki.org/5/de10ea60-bba4-11e6-9bdb-395cce787fb5.png',
                    'http://fileservice.experimental.slidewiki.org/5/de1186a0-bba4-11e6-9bdb-395cce787fb5.png',
                    'http://fileservice.experimental.slidewiki.org/5/de1249f0-bba4-11e6-9bdb-395cce787fb5.png',
                    'http://fileservice.experimental.slidewiki.org/5/de12e630-bba4-11e6-9bdb-395cce787fb5.png',
                    'https://fileservice.experimental.slidewiki.org/2/896eff50-1b86-11e7-9791-51f71d7b28b5.png',
                    'https://fileservice.experimental.slidewiki.org/2/897010c0-1b86-11e7-9791-51f71d7b28b5.jpeg',
                    'https://fileservice.experimental.slidewiki.org/2/89712230-1b86-11e7-9791-51f71d7b28b5.jpeg'
                ]);
            });

        });
    });

});
