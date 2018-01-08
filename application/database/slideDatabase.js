/*
Controller for handling mongodb and the data model slide while providing CRUD'ish.
*/

'use strict';

const util = require('../lib/util');

const helper = require('./helper'),
    slideModel = require('../models/slide.js'),
    oid = require('mongodb').ObjectID;

const deckDB = require('./deckDatabase');

let self = module.exports = {

    exists: function(identifier) {
        return helper.getCollection('slides').then((col) => {
            let slide = util.parseIdentifier(identifier);
            if (!slide) return false;

            let query = { _id: slide.id };
            if (slide.revision) {
                query['revisions.id'] = slide.revision;
            }

            return col.find(query).hasNext();
        });
    },

    get: function(identifier) {
        let slide = util.parseIdentifier(identifier);
        if (!slide) return Promise.resolve();

        return helper.getCollection('slides')
        .then((col) => col.findOne({ _id: slide.id }))
        .then((found) => {
            if (!found) return;

            if (!slide.revision) {
                // no revision specified, return all

                // TODO migration fix remove _id from data sources
                found.revisions.forEach((rev) => {
                    if (!rev.dataSources) return;
                    rev.dataSources.forEach((i) => delete i._id);
                });

                return found;
            }

            let revision = found.revisions.find((rev) => rev.id === slide.revision);
            if (!revision) {
                return;
            }

            // TODO migration fix remove _id from data sources
            if (revision.dataSources) revision.dataSources.forEach((i) => delete i._id);
            found.revisions = [revision];

            return found;
        });

    },

    getAll: function(identifier) {
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => col.find({ content_id: String(oid(identifier)) }))//TODO use id TODO cast to String?
        .then((stream) => stream.sort({timestamp: -1}))
        .then((stream) => stream.toArray());
    },

    getSelected: function(identifiers) {
        return helper.connectToDatabase()
        .then((db) => db.collection('slides'))
        .then((col) => col.find({ _id:  { $in : identifiers.selectedIDs }}))
        .then((stream) => stream.sort({timestamp: -1}))
        .then((stream) => stream.toArray());
    },

    getAllFromCollection: function() {
        return helper.connectToDatabase()
        .then((db) => db.collection('slides'))
        .then((col) => col.find())
        .then((stream) => stream.sort({timestamp: -1}))
        .then((stream) => stream.toArray());
    },

    insert: function(slide) {
        // check if parentDeck has revision
        let parentDeck = util.parseIdentifier(slide.root_deck);
        if (parentDeck && !parentDeck.revision) {
            // need to find the latest revision id
            return deckDB.getLatestRevision(parentDeck.id)
            .then((parentRevision) => {
                if (!parentRevision) return;

                parentDeck.revision = parentRevision;
                slide.root_deck = util.toIdentifier(parentDeck);

                return self._insert(slide);
            });
        }

        return self._insert(slide);
    },

    _insert: function(slide) {
        return helper.connectToDatabase()
        .then((db) => helper.getNextIncrementationValueForCollection(db, 'slides'))
        .then((newId) => {
            return helper.getCollection('slides').then((slides) => {
                slide._id = newId;
                const convertedSlide = convertToNewSlide(slide);
                if (!slideModel(convertedSlide)) {
                    throw new Error(JSON.stringify(slideModel.errors));
                }

                return slides.insertOne(convertedSlide);
            });
        });
    },

    copy: function(slide, slideRevision){
        return helper.connectToDatabase()
        .then((db) => helper.getNextIncrementationValueForCollection(db, 'slides'))
        .then((newId) => {
            return helper.connectToDatabase() //db connection have to be accessed again in order to work with more than one collection
            .then((db2) => db2.collection('slides'))
            .then((col) => {
                slide._id = newId;
                let revisionCopied = slide.revisions[slideRevision];
                let now = new Date();
                let timestamp = now.toISOString();
                let parentArray = slide.parent.split('-');
                if(parentArray.length > 1){
                    revisionCopied.parent = {'id': parseInt(parentArray[0]), 'revision': parseInt(parentArray[1])};
                }
                else{
                    revisionCopied.parent = slide.parent;
                }
                revisionCopied.usage = [];
                revisionCopied.comment = slide.comment;
                revisionCopied.id = 1;
                revisionCopied.timestamp = timestamp;
                slide.revisions = [revisionCopied];
                slide.timestamp = timestamp;
                delete slide.parent;
                delete slide.comment;
                try {
                    return col.insertOne(slide);
                } catch (e) {
                    console.log('validation failed', e);
                }
                return;
            });
        });
    },

    replace: function(id, slide) {
        let idArray = String(id).split('-');
        if(idArray.length > 1){
            id = idArray[0];
        }
        return helper.connectToDatabase()
        .then((db) => db.collection('slides'))
        .then((col) => {
            return col.findOne({_id: parseInt(id)})
            .then((existingSlide) => {
                const maxRevisionId = existingSlide.revisions.reduce((prev, curr) => {
                    if (curr.id > prev)
                        return curr.id;

                    return prev;
                }, 1);
                let usageArray = existingSlide.revisions[idArray[1]-1].usage;
                //we should remove the usage of the previous revision in the root deck
                let previousUsageArray = JSON.parse(JSON.stringify(usageArray));
                if(slide.root_deck){

                    for(let i = 0; i < previousUsageArray.length; i++){
                        if(previousUsageArray[i].id === parseInt(slide.root_deck.split('-')[0]) && previousUsageArray[i].revision === parseInt(slide.root_deck.split('-')[1])){
                            previousUsageArray.splice(i,1);
                            break;
                        }
                    }
                }

                let valid = false;
                //should empty usage array and keep only the new root deck revision
                usageArray = [{'id':parseInt(slide.root_deck.split('-')[0]), 'revision': parseInt(slide.root_deck.split('-')[1])}];
                let slideWithNewRevision = convertSlideWithNewRevision(slide, parseInt(maxRevisionId)+1, usageArray);
                slideWithNewRevision.timestamp = existingSlide.timestamp;
                slideWithNewRevision.license = existingSlide.license;
                slideWithNewRevision.user = existingSlide.user;
                if(existingSlide.hasOwnProperty('contributors')){
                    let contributors = existingSlide.contributors;
                    let existingUserContributorIndex = findWithAttr(contributors, 'user', slide.user);
                    if(existingUserContributorIndex > -1)
                        contributors[existingUserContributorIndex].count++;
                    else{
                        contributors.push({'user': slide.user, 'count': 1});
                    }
                    slideWithNewRevision.contributors = contributors;
                }

                try {
                    valid = slideModel(slideWithNewRevision);
                    if (!valid) {
                        return slideModel.errors;
                    }
                    let new_revisions = existingSlide.revisions;
                    new_revisions[idArray[1]-1].usage = previousUsageArray;
                    new_revisions.push(slideWithNewRevision.revisions[0]);
                    slideWithNewRevision.revisions = new_revisions;
                    return col.findOneAndUpdate({
                        _id: parseInt(id)
                    }, { $set: slideWithNewRevision }, {new: true});
                } catch (e) {
                    console.log('validation failed', e);
                }
                return;
            });
        });
    },

    revert: function(slideId, revisionId, path, userId) {
        return self.get(slideId).then((slide) => {
            if (!slide) return;

            // also check if revisionId we revert to exists
            let revision = slide.revisions.find((r) => r.id === revisionId);
            if (!revision) return;

            // the parent of the slide is the second to last item of the path
            // path has at least length 2, guaranteed
            let [parentDeck] = path.slice(-2, -1);
            let parentDeckId = util.toIdentifier(parentDeck);

            let rootDeckId = util.toIdentifier(path[0]);

            // update the content items of the parent deck to reflect the slide revert
            return deckDB.updateContentItem(slide, revisionId, parentDeckId, 'slide', userId, rootDeckId)
            .then(({oldRevision, updatedDeckRevision}) => {
                // make old slide id canonical
                let oldSlideId = util.toIdentifier({ id: slideId, revision: parseInt(oldRevision) });

                //update the usage of the reverted slide to point to the parent deck before returning
                return self.updateUsage(oldSlideId, revisionId, parentDeckId)
                .then((updatedSlide) => updatedSlide);
            });
        });
    },

    saveDataSources: function(id, dataSources) {
        let idArray = id.split('-');

        return helper.connectToDatabase()
        .then((db) => db.collection('slides'))
        .then((col) => {
            return col.findOne({_id: parseInt(idArray[0])})
            .then((existingSlide) => {
                try {
                    const revisionId = idArray[1];
                    let revision = (revisionId !== undefined) ? existingSlide.revisions.find((revision) => String(revision.id) === String(revisionId)) : undefined;
                    if (revision !== undefined) {
                        revision.dataSources = dataSources;
                    }

                    col.save(existingSlide);
                    return dataSources;
                } catch (e) {
                    console.log('saveDataSources failed', e);
                }
                return;
            });
        });
    },

    rename: function(slide_id, newName){
        let slideId = slide_id.split('-')[0];
        return helper.connectToDatabase()
        .then((db) => db.collection('slides'))
        .then((col) => col.findOne({_id: parseInt(slideId)})
        .then((slide) => {
            if(slide.revisions.length > 1){
                slide.revisions[slide_id.split('-')[1]-1].title = newName;
            }
            else{
                slide.revisions[0].title = newName;
            }
            return col.findOneAndUpdate({_id: parseInt(slideId)}, slide);
        }));
    },

    updateUsage: function(slide, new_revision_id, root_deck){
        let idArray = slide.split('-');
        let rootDeckArray = root_deck.split('-');
        return helper.connectToDatabase()
        .then((db) => db.collection('slides'))
        .then((col) => {
            return col.findOne({_id: parseInt(idArray[0])})
            .then((existingSlide) => {
                //first remove usage of deck from old revision
                let usageArray = existingSlide.revisions[parseInt(idArray[1])-1].usage;
                for(let i = 0; i < usageArray.length; i++){
                    if(usageArray[i].id === parseInt(rootDeckArray[0]) && usageArray[i].revision === parseInt(rootDeckArray[1])){
                        usageArray.splice(i,1);
                        break;
                    }
                }
                //then update usage array of new/reverted revision
                let contains = false;
                for(let j = 0; j < existingSlide.revisions[parseInt(new_revision_id)-1].usage.length; j++){
                    if(existingSlide.revisions[parseInt(new_revision_id)-1].usage[j].id === parseInt(rootDeckArray[0]) && existingSlide.revisions[parseInt(new_revision_id)-1].usage[j].revision === parseInt(rootDeckArray[1])){
                        contains = true;
                        break;
                    }
                }
                if(!contains)
                    existingSlide.revisions[parseInt(new_revision_id)-1].usage.push({'id': parseInt(rootDeckArray[0]), 'revision': parseInt(rootDeckArray[1])});

                return col.save(existingSlide).then(() => existingSlide);
            });
        });
    },

    addToUsage: function(itemToAdd, root_deck_path){
        let itemId = itemToAdd.ref.id;
        let itemRevision = itemToAdd.ref.revision;
        let usageToPush = {id: parseInt(root_deck_path[0]), revision: parseInt(root_deck_path[1])};
        if(itemToAdd.kind === 'slide'){
            return helper.connectToDatabase()
            .then((db) => db.collection('slides'))
            .then((col2) => {
                return col2.findOneAndUpdate(
                    {_id: parseInt(itemId), 'revisions.id':itemRevision},
                    {$push: {'revisions.$.usage': usageToPush}}
                );
            });
        }
        else{
            return helper.connectToDatabase()
            .then((db) => db.collection('decks'))
            .then((col2) => {
                return col2.findOneAndUpdate(
                    {_id: parseInt(itemId), 'revisions.id':itemRevision},
                    {$push: {'revisions.$.usage': usageToPush}}
                );
            });
        }
    },

    getTags(slideIdParam){
        let {slideId, revisionId} = splitSlideIdParam(slideIdParam);

        return helper.connectToDatabase()
        .then((db) => db.collection('slides'))
        .then((col) => {
            return col.findOne({_id: parseInt(slideId)})
            .then((slide) => {

                if(!slide || revisionId === null || !slide.revisions[revisionId])
                    return;

                return (slide.revisions[revisionId].tags || []);
            });
        });
    },

    addTag: function(slideIdParam, tag) {
        let {slideId, revisionId} = splitSlideIdParam(slideIdParam);

        return helper.connectToDatabase()
        .then((db) => db.collection('slides'))
        .then((col) => {
            return col.findOne({_id: parseInt(slideId)})
            .then((slide) => {

                if(!slide || revisionId === null || !slide.revisions[revisionId]) return;

                if(!slide.revisions[revisionId].tags){
                    slide.revisions[revisionId].tags = [];
                }

                // check if new tag already exists in tags array
                if(!slide.revisions[revisionId].tags.some((element) => {
                    return element.tagName === tag.tagName;
                })){
                    slide.revisions[revisionId].tags.push(tag);
                    col.save(slide);
                }

                return slide.revisions[revisionId].tags;
            });
        });
    },

    removeTag: function(slideIdParam, tag){
        let {slideId, revisionId} = splitSlideIdParam(slideIdParam);

        return helper.connectToDatabase()
        .then((db) => db.collection('slides'))
        .then((col) => {
            return col.findOne({_id: parseInt(slideId)})
            .then((slide) => {

                if(!slide || revisionId === null || !slide.revisions[revisionId]) return;

                slide.revisions[revisionId].tags = (slide.revisions[revisionId].tags || []).filter( (el) => {
                    return el.tagName !== tag.tagName;
                });

                col.save(slide);
                return slide.revisions[revisionId].tags;
            });
        });
    },

    // fetches change log records for the slide as it appears in the deck tree with given root
    getChangeLog: function(identifier, rootIdentifier) {
        // always check if slide exists to return a 404
        return self.get(identifier).then((existingSlide) => {
            if (!existingSlide) return;

            let slideId = util.parseIdentifier(identifier).id;
            let rootDeck = util.parseIdentifier(rootIdentifier);

            let deckQuery = { id: rootDeck.id, };
            if (rootDeck.revision) {
                deckQuery.revision = { $lte: rootDeck.revision };
            }

            return helper.getCollection('deckchanges').then((changes) => {
                return changes.aggregate([
                    { $match: {
                        'path': { $elemMatch: deckQuery },
                        'value.kind': 'slide',
                        'value.ref.id': slideId,
                    } },
                    // { $project: { _id: 0 } }, // TODO re-insert this after 3.4 upgrade
                    { $sort: { timestamp: 1 } },
                ]);
            }).then((result) => result.toArray());
        });

    },

};

// split slide id given as parameter to slide id and revision id
function splitSlideIdParam(slideId){
    let revisionId = null;
    let tokens = slideId.split('-');
    if(tokens.length > 1){
        slideId = tokens[0];
        revisionId = tokens[1]-1;
    }

    return {slideId, revisionId};
}

function convertToNewSlide(slide) {
    let now = new Date();
    slide.user = parseInt(slide.user);

    let usageArray = [util.parseIdentifier(slide.root_deck)];

    if(slide.language === null){
        slide.language = 'en_EN';
    }
    let contributorsArray = [{'user': slide.user, 'count': 1}];
    const result = {
        _id: slide._id,
        user: slide.user,
        timestamp: now.toISOString(),
        lastUpdate: now.toISOString(),
        language: slide.language,
        license: slide.license,
        contributors: contributorsArray,
        description: slide.description,
        revisions: [{
            id: 1,
            usage: usageArray,
            timestamp: now.toISOString(),
            user: slide.user,
            title: slide.title,
            content: slide.content,
            speakernotes: slide.speakernotes,
            parent: slide.parent_slide,
            tags: slide.tags,
            license: slide.license,
        }]
    };
    if (slide.dimensions) {
        result.revisions[0].dimensions = slide.dimensions;
    }
    return result;
}

function convertSlideWithNewRevision(slide, newRevisionId, usageArray) {
    let now = new Date();
    slide.user = parseInt(slide.user);
    if(slide.language === null){
        slide.language = 'en_EN';
    }
    const result = {
        lastUpdate: now.toISOString(),
        language: slide.language,
        license: slide.license,
        revisions: [{
            id: newRevisionId,
            usage: usageArray,
            timestamp: now.toISOString(),
            user: slide.user,
            title: slide.title,
            content: slide.content,
            speakernotes: slide.speakernotes,
            tags: slide.tags,
            dataSources: slide.dataSources,
            license: slide.license
        }]
    };
    if (slide.dimensions) {
        result.revisions[0].dimensions = slide.dimensions;
    }
    return result;
}

function findWithAttr(array, attr, value) {
    for(let i = 0; i < array.length; i++) {
        if(array[i][attr] === value) {
            return i;
        }
    }
    return -1;
}
