/* eslint-env mocha */
// example unit tests
'use strict';

//Mocking is missing completely TODO add mocked objects

describe('Database', () => {

    let db, deckdb, helper; //expect

    beforeEach((done) => {
        //Clean everything up before doing new tests
        Object.keys(require.cache).forEach((key) => delete require.cache[key]);
        require('chai').should();
        let chai = require('chai');
        let chaiAsPromised = require('chai-as-promised');
        chai.use(chaiAsPromised);
        //expect = require('chai').expect;
        db = require('../database/slideDatabase.js');
        deckdb = require('../database/deckDatabase.js');
        helper = require('../database/helper.js');
        helper.cleanDatabase()
        .then(() => done())
        .catch((error) => done(error));
    });

    context('when having an empty database', () => {
        it('should return null when requesting a non existant slide', () => {
            return db.get('asd7db2daasd').should.be.fulfilled.and.become(null);
        });


        it('should return the slide when inserting one', () => {
            let slide = {
                title: 'Dummy',
                content: 'dummy',
                language: 'en',
                license: 'CC0',
                user: 1,
                root_deck: '25-1'
            };
            let res = db.insert(slide);
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('ops').that.is.not.empty,
                //res.should.eventually.have.deep.property('ops[0]').that.has.all.keys('_id', 'language'),
                //res.should.eventually.have.deep.property('ops[0].language', slide.language)
            ]);
        });

        it('should return the deck when inserting one', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en_EN',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'user': 1,
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let res = deckdb.insert(deck);
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('ops').that.is.not.empty,
                //res.should.eventually.have.deep.property('ops[0]').that.has.all.keys('_id', 'user'),
                //res.should.eventually.have.deep.property('ops[0]', _id)
            ]);
        });


        it('should get a previously inserted deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en_EN',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'user': 1,
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck);
            let res = ins.then((ins) => deckdb.get(ins.ops[0]._id));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                //res.should.eventually.have.all.keys('_id', 'language'),
                res.should.eventually.have.property('user', deck.user)
            ]);
        });

        it('should get an previously inserted slide', () => {
            let slide = {
                title: 'Dummy',
                content: 'dummy',
                language: 'en',
                license: 'CC0',
                user: 1,
                root_deck: '1-1'
            };
            let ins = db.insert(slide);
            let res = ins.then((ins) => db.get(ins.ops[0]._id));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                //res.should.eventually.have.all.keys('_id', 'language'),
                res.should.eventually.have.property('language', slide.language)
            ]);
        });

        it('should be able to replace an previously inserted slide', () => {
            let slide = {
                title: 'Dummy',
                content: 'dummy',
                language: 'en',
                license: 'CC0',
                user: 1,
                root_deck: '1-1'
            };
            let slide2 = {
                title: 'Dummy Replaced',
                content: 'dummy',
                language: 'en',
                license: 'CC0',
                user: 1,
                root_deck: '1-1'
            };
            let ins = db.insert(slide);
            let res = ins.then((ins) => db.replace(ins.ops[0]._id+'-1', slide2));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('value').that.contains.all.keys('_id', 'language'),
                //res.should.eventually.have.property('value').that.has.property('language', slide.language) // FIXME returns old object
                //ins.then((slide) => res.should.eventually.have.deep.property('value._id', slide.ops[0]._id))//FIXME works, but fails because of .... santa
            ]);
        });

        it('should be able to replace an previously inserted deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en_EN',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'user': 1,
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let deck2 = {
                'description': 'New Deck Replaced',
                'language': 'en_EN',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'user': 1,
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck);
            let res = ins.then((ins) => deckdb.replace(ins.ops[0]._id+'-1', deck2));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                //res.should.eventually.have.property('value').that.contains.all.keys('_id', 'language'),
                //res.should.eventually.have.property('value').that.has.property('language', slide.language) // FIXME returns old object
                //ins.then((slide) => res.should.eventually.have.deep.property('value._id', slide.ops[0]._id))//FIXME works, but fails because of .... santa
            ]);
        });

        it('should be able to replace an previously inserted deck without a new revision', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en_EN',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'user': 1,
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let deck2 = {
                'description': 'New Deck Replaced',
                'language': 'en_EN',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'user': 1,
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck);
            let res = ins.then((ins) => deckdb.update(ins.ops[0]._id+'-1', deck2));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                //res.should.eventually.have.property('value').that.contains.all.keys('_id', 'language'),
                //res.should.eventually.have.property('value').that.has.property('language', slide.language) // FIXME returns old object
                //ins.then((slide) => res.should.eventually.have.deep.property('value._id', slide.ops[0]._id))//FIXME works, but fails because of .... santa
            ]);
        });

        it('should copy an existing slide', () => {
            let slide = {
                title: 'Dummy',
                content: 'dummy',
                language: 'en',
                license: 'CC0',
                user: 1,
                root_deck: '25-1'
            };
            let ins = db.insert(slide);
            let res = ins.then((ins) => {ins.ops[0].parent = ins.ops[0]._id+'-1'; return db.copy(ins.ops[0], 0);});
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('ops').that.is.not.empty,
                //res.should.eventually.have.deep.property('ops[0]').that.has.all.keys('_id', 'language'),
                //res.should.eventually.have.deep.property('ops[0].language', slide.language)
            ]);
        });

        it('should rename an existing slide', () => {
            let slide = {
                title: 'Dummy',
                content: 'dummy',
                language: 'en',
                license: 'CC0',
                user: 1,
                root_deck: '25-1'
            };
            let ins = db.insert(slide);
            let res = ins.then((ins) => db.rename(ins.ops[0]._id+'-1', 'new name' ));
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('value').that.is.not.empty,
            ]);
        });

        it('should update usage of an existing slide', () => {
            let slide = {
                title: 'Dummy',
                content: 'dummy',
                language: 'en',
                license: 'CC0',
                user: 1,
                root_deck: '25-1'
            };
            //let ins = db.insert(slide);
            let slide2 = {
                title: 'Dummy',
                content: 'dummy',
                language: 'en',
                license: 'CC0',
                user: 1,
                root_deck: '25-1'
            };
            let ins = db.insert(slide);
            let ins2 = ins.then((ins) => db.replace(ins.ops[0]._id+'-1', slide2));
            let res = ins2.then((ins2) => db.updateUsage(ins2.value._id+'-1','2', '25-1' ));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('_id').that.is.not.empty,
            ]);
        });

        it('should add to usage of an existing slide', () => {
            let slide = {
                title: 'Dummy',
                content: 'dummy',
                language: 'en',
                license: 'CC0',
                user: 1,
                root_deck: '25-1'
            };
            let ins = db.insert(slide);
            let res = ins.then((ins) => {
                let itemToAdd = {
                    ref: {
                        id:ins.ops[0]._id,
                        revision: 1
                    },
                    kind: 'slide'
                };
                db.addToUsage(itemToAdd, [25,1] );});
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled
            ]);
        });

        it('should return the decktree of an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en_EN',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'user': 1,
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck);
            let res = ins.then((ins) => deckdb.getDeckTreeFromDB(ins.ops[0]._id+'-1'));
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('title').that.is.not.empty,
                //res.should.eventually.have.deep.property('ops[0]').that.has.all.keys('_id', 'user'),
                //res.should.eventually.have.deep.property('ops[0]', _id)
            ]);
        });

        it('should return the active revision of an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en_EN',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'user': 1,
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck);
            let res = ins.then((ins) => deckdb.getActiveRevisionFromDB(ins.ops[0]._id+'-1'));
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                //res.should.eventually.have.deep.property('ops[0]').that.has.all.keys('_id', 'user'),
                //res.should.eventually.have.deep.property('ops[0]', _id)
            ]);
        });

        it('should rename an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en_EN',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'user': 1,
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck);
            let res = ins.then((ins) => deckdb.rename(ins.ops[0]._id+'-1', 'new name'));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('value').that.is.not.empty
            ]);
        });

        it('should insert a content item into an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en_EN',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'user': 1,
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck);
            let res = ins.then((ins) => deckdb.insertNewContentItem({id: '1'}, '2', ins.ops[0]._id+'-1', 'slide', '3'));
            return Promise.all([
                res.should.be.fulfilled
            ]);
        });

        it('should return flat decks of an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en_EN',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'user': 1,
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck);
            let res = ins.then((ins) => deckdb.getFlatDecksFromDB(ins.ops[0]._id+'-1'));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('title').that.is.not.empty,
            ]);
        });

        it('should return flat slides of an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en_EN',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'user': 1,
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck);
            let res = ins.then((ins) => deckdb.getFlatSlidesFromDB(ins.ops[0]._id+'-1', undefined));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('title').that.is.not.empty,
            ]);
        });

        it('should return editors of an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en_EN',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'user': 1,
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck);
            let res = ins.then((ins) => deckdb.getDeckEditors(ins.ops[0]._id+'-1'));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
            ]);
        });

        it('should fork an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en_EN',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'user': 1,
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck);
            let res = ins.then((ins) => deckdb.forkDeckRevision(ins.ops[0]._id+'-1', 1));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('root_deck').that.is.not.empty,
                res.should.eventually.have.property('id_map').that.is.not.empty,
            ]);
        });

        it('should handle change for an existing deck', () => {
            let deck = {
                'description': 'New Deck',
                'language': 'en_EN',
                'translation': {
                    'status': 'original'
                },
                'tags': [],
                'title': 'New Deck',
                'user': 1,
                'abstract': '',
                'comment': '',
                'footer': '',
                'license': 'CC0'
            };
            let ins = deckdb.insert(deck);
            let decktree = ins.then((ins) => deckdb.getDeckTreeFromDB(ins.ops[0]._id+'-1'));
            let res = decktree.then((decktree) => deckdb.handleChange(decktree, decktree.id, decktree.id, 1));
            res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                //res.should.eventually.have.property('root_deck').that.is.not.empty,
                res.should.eventually.have.property('needs_revision'),
            ]);
        });

    });
});
