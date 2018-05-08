/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
'use strict';

//Mocking is missing completely TODO add mocked objects

describe('Database', () => {

    let db, deckdb, treedb, helper; //expect

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
        treedb = require('../database/deckTreeDatabase');
        helper = require('../database/helper.js');
        helper.cleanDatabase()
        .then(() => done())
        .catch((error) => done(error));
    });

    context('when having an empty database', () => {
        it('should return nothing when requesting a non existant slide', () => {
            return db.get('asd7db2daasd').should.be.fulfilled.and.become(undefined);
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
                res.should.eventually.be.not.empty,
                res.should.eventually.include.all.keys('_id', 'language'),
                res.should.eventually.have.property('language', slide.language)
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
                res.should.eventually.be.not.empty,
                res.should.eventually.include.all.keys('_id', 'user')
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
            let res = ins.then((ins) => deckdb.get(ins._id));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                // res.should.eventually.include.all.keys('_id', 'language'),
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
            let res = ins.then((ins) => db.get(ins._id));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.include.all.keys('_id', 'language'),
                res.should.eventually.have.property('language', slide.language)
            ]);
        });

        it('should be able to replace a previously inserted slide', () => {
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
            let res = ins.then((ins) => db.replace(ins._id+'-1', slide2));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.include.all.keys('id', 'revision'),
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
            let res = ins.then((ins) => deckdb.update(ins._id+'-1', deck2));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.include.all.keys('_id'),
                res.should.eventually.have.nested.property('revisions.0.language', deck.language),
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
            let res = ins.then((ins) => {ins.parent = ins._id+'-1'; return db._copy(ins, 0);});
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.nested.property('ops[0]').that.includes.all.keys('_id', 'language'),
                res.should.eventually.have.nested.property('ops[0].language', slide.language)
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
            let res = ins.then((ins) => db.rename(ins._id+'-1', 'new name' ));
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
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
            let ins2 = ins.then((ins) => db.replace(ins._id+'-1', slide2));
            let res = ins2.then((ins2) => db.updateUsage(ins2.id+'-1','2', '25-1' ));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('_id').that.is.a('number'),
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
                        id:ins._id,
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
            let res = ins.then((ins) => deckdb.getDeckTreeFromDB(ins._id+'-1'));
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('title').that.is.not.empty,
                //res.should.eventually.have.all.keys('_id', 'user')
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
            let res = ins.then((ins) => deckdb.getActiveRevisionFromDB(ins._id+'-1'));
            //res.then((data) => console.log('resolved', data));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                //res.should.eventually.have.all.keys('_id', 'user'),
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
            let res = ins.then((ins) => deckdb.rename(ins._id+'-1', 'new name'));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
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
            let res = ins.then((ins) => deckdb.insertNewContentItem({id: '1', revisions: [{},{},{user:2}]}, '2', ins._id+'-1', 'slide', '3'));
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
            let res = ins.then((ins) => deckdb.getFlatDecks(ins._id+'-1'));
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
            let res = ins.then((ins) => deckdb.getFlatSlides(ins._id+'-1', undefined));
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
            let res = ins.then((ins) => deckdb.getDeckEditors(ins._id+'-1'));
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
            let res = ins.then((ins) => treedb.copyDeckTree(ins._id+'-1', 1));
            return Promise.all([
                res.should.be.fulfilled.and.eventually.not.be.empty,
                res.should.eventually.have.property('root_deck').that.is.not.empty,
                res.should.eventually.have.property('id_map').that.is.not.empty,
            ]);
        });

    });
});
