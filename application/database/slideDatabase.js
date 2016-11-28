/*
Controller for handling mongodb and the data model slide while providing CRUD'ish.
*/

'use strict';

const helper = require('./helper'),
    slideModel = require('../models/slide.js'),
    oid = require('mongodb').ObjectID;

module.exports = {
    get: function(identifier) {
        identifier = String(identifier);
        let idArray = identifier.split('-');
        return helper.connectToDatabase()
        .then((db) => db.collection('slides'))
        //must parse the identifier to check if it is dash separated (get revision) or not (get the whole slide)
        .then((col) => col.findOne({
            _id: parseInt(idArray[0])
        })
        )
        .then((found) => {
            if(idArray.length === 1){
                return found;
            }
            else{
                //array index of revision is revision number minus 1
                let revision = found.revisions[parseInt(idArray[1])-1];
                if(typeof revision === 'undefined'){
                    return ;
                }
                else{
                    found.revisions = [revision];
                    return found;
                }
                // revision.id = identifier;
                // revision.kind = 'slide';
                // return revision;
            }
        }).catch((error) => {
            throw error;
        });

    },

    getAll: function(identifier) { //TODO Darya: is this function in use?
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => col.find({ content_id: String(oid(identifier)) }))//TODO use id TODO cast to String?
        .then((stream) => stream.sort({timestamp: -1}))
        .then((stream) => stream.toArray());
    },

    getSelected: function(identifiers) {
        return helper.connectToDatabase()
        .then((db) => db.collection('slides'))
        .then((col) => col.find({ _id:  { $in : identifiers.selectedIDs.map(function(id) {
            return oid(id);
        })
    }}))
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
        //TODO check for root and parent deck ids to be existant, otherwise create these
        return helper.connectToDatabase()
        .then((db) => helper.getNextIncrementationValueForCollection(db, 'slides'))
        .then((newId) => {
            return helper.connectToDatabase() //db connection have to be accessed again in order to work with more than one collection
            .then((db2) => db2.collection('slides'))
            .then((col) => {
                let valid = false;
                slide._id = newId;
                try {
                    const convertedSlide = convertToNewSlide(slide);
                    valid = slideModel(convertedSlide);
                    // console.log('validated slidemodel', valid);
                    if (!valid) {
                        return slideModel.errors;
                    }
                    //create thumbnail here

                    return col.insertOne(convertedSlide);
                } catch (e) {
                    console.log('validation failed', e);
                }
                return;
            }); //id is created and concatinated automatically
        });
    },

    copy: function(slide, slideRevision){
        return helper.connectToDatabase()
        .then((db) => helper.getNextIncrementationValueForCollection(db, 'slides'))
        .then((newId) => {
            return helper.connectToDatabase() //db connection have to be accessed again in order to work with more than one collection
            .then((db2) => db2.collection('slides'))
            .then((col) => {
                let valid = false;
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
                revisionCopied.comment = slide.comment;
                revisionCopied.id = 1;
                revisionCopied.timestamp = timestamp;
                slide.revisions = [revisionCopied];
                slide.timestamp = timestamp;
                // let contributors = slide.contributors;
                // let existingUserContributorIndex = findWithAttr(contributors, 'user', slide.user);
                // if(existingUserContributorIndex > -1)
                //     contributors[existingUserContributorIndex].count++;
                // else{
                //     contributors.push({'user': slide.user, 'count': 1});
                // }
                // slide.contributors = contributors;
                delete slide.parent;
                delete slide.comment;
                try {
                    return col.insertOne(slide);
                } catch (e) {
                    console.log('validation failed', e);
                }
                return;
            }); //id is created and concatinated automatically
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
                    //console.log(slide.root_deck);

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
                    //}, { $push: { revisions: slideWithNewRevision.revisions[0] } }, {new: true});
                    }, { $set: slideWithNewRevision }, {new: true});
                } catch (e) {
                    console.log('validation failed', e);
                }
                return;
            });
        });
    },

    replaceNoRevision: function(id, slide) {
        let idArray = id.split('-');

        return helper.connectToDatabase()
        .then((db) => db.collection('slides'))
        .then((col) => {
            return col.findOne({_id: parseInt(idArray[0])})
            .then((existingSlide) => {

                let valid = false;
                const slideWithNewRevision = convertSlideWithNewRevision(slide, parseInt(idArray[1]));

                try {
                    valid = slideModel(slideWithNewRevision);

                    if (!valid) {
                        return slideModel.errors;
                    }
                    slideWithNewRevision.revisions[0].usage = existingSlide.revisions[idArray[1]-1].usage;
                    existingSlide.revisions[parseInt(idArray[1])-1] = slideWithNewRevision.revisions[0];
                    col.save(existingSlide);
                    return slideWithNewRevision;
                } catch (e) {
                    console.log('validation failed', e);
                }
                return;
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

    revert: function(slide_id, slide){ //this can actually revert to past and future revisions
        //NOTE must add validation on id
        return helper.connectToDatabase()
        .then((db) => db.collection('slides'))
        .then((col) => {
            col.findOne({_id: parseInt(slide_id)})
            .then((existingSlide) => {
                helper.connectToDatabase().collection('slides').findOne({_id: parseInt(existingSlide.deck)})
                .then((root_deck) => {
                    //console.log(root_deck);
                    for(let i = 0; i < root_deck.revisions.length; i++) {
                        if(root_deck.revisions[i].id === root_deck.active) {
                            for(let j = 0; j < root_deck.revisions[i].contentItems.length; j++) {
                                if(root_deck.revisions[i].contentItems[j].ref.id === String(slide_id)) {
                                    root_deck.revisions[i].contentItems[j].ref.revision = parseInt(slide.revision_id);
                                }
                                else continue;
                            }
                        }
                        else continue;
                    }
                    col.save(root_deck);
                });
            });
        });
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
                  //existingSlide.revisions[parseInt(new_revision_id)-1].usage.push({'id': parseInt(rootDeckArray[0]), 'revision': parseInt(rootDeckArray[1])});
                  col.save(existingSlide);
                  return existingSlide;
              });
        });
    },
    
    addToUsage: function(itemToAdd, root_deck_path){
        let itemId = itemToRemove.ref.id;
        let itemRevision = itemToRemove.ref.revision;
        if(itemToRemove.kind === 'slide'){
            helper.connectToDatabase()
            .then((db) => db.collection('slides'))
            .then((col2) => {
                col2.findOneAndUpdate(
                    {_id: parseInt(itemId), 'revisions.id':itemRevision},
                    {$push: {'revisions.$.usage': {id: itemId, revision: itemRevision}}}
                );
            });
        }
        else{
            helper.connectToDatabase()
            .then((db) => db.collection('decks'))
            .then((col2) => {
                col2.findOneAndUpdate(
                    {_id: parseInt(itemId), 'revisions.id':itemRevision},
                    {$push: {'revisions.$.usage': {id: itemId, revision: itemRevision}}}
                );
            });
        }
    }
};

function convertToNewSlide(slide) {
    let now = new Date();
    //let root_deck = String(slide.root_deck.split('-')[0]); //we should put the deck revision in the usage as well...
    slide.user = parseInt(slide.user);
    let root_deck_array = slide.root_deck.split('-');
    let usageArray = [];
    usageArray.push({
        'id': parseInt(root_deck_array[0]),
        'revision': parseInt(root_deck_array[1])
    });
    if(slide.language === null){
        slide.language = 'en_EN';
    }
    let contributorsArray = [{'user': slide.user, 'count': 1}];
    const result = {
        _id: slide._id,
        user: slide.user,
        //kind: 'slide',
        //deck: String(slide.root_deck.split('-')[0]),
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
    //console.log('from', slide, 'to', result);
    return result;
}

function convertSlideWithNewRevision(slide, newRevisionId, usageArray) {
    let now = new Date();
    slide.user = parseInt(slide.user);
    if(slide.language === null){
        slide.language = 'en_EN';
    }
    const result = {
        //user: slide.user,
        //deck: slide.root_deck,
        //timestamp: now.toISOString(),
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
            //parent: slide.parent_slide
        }]
    };
    //console.log('from', slide, 'to', result);
    return result;
}

function findWithAttr(array, attr, value) {
    for(var i = 0; i < array.length; i++) {
        if(array[i][attr] === value) {
            return i;
        }
    }
    return -1;
}
