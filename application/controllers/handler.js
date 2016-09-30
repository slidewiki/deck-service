/*
Handles the requests by executing stuff and replying to the client. Uses promises to get stuff done.
*/

'use strict';

const boom = require('boom'),
    slideDB = require('../database/slideDatabase'),
    deckDB = require('../database/deckDatabase'),
    co = require('../common'),
    Joi = require('joi'),
    Microservices = require('../configs/microservices');

let self = module.exports = {
    getSlide: function(request, reply) {
        //NOTE shall the response be cleaned or enhanced with values?
        slideDB.get(encodeURIComponent(request.params.id)).then((slide) => {
            if (co.isEmpty(slide))
                reply(boom.notFound());
            else
            //reply(co.rewriteID(slide));
            reply(slide);
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    //Get All Slides from database
    getAllSlides: function(request, reply) {
        slideDB.getAllFromCollection()
        .then((slides) => {
            slides.forEach((slide) => {
                co.rewriteID(slide);
                //activity.author = authorsMap.get(activity.user_id);//insert author data
            });

            let jsonReply = JSON.stringify(slides);
            reply(jsonReply);

        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    newSlide: function(request, reply) {
        //NOTE shall the response be cleaned or enhanced with values?
        slideDB.insert(request.payload).then((inserted) => {
            if (co.isEmpty(inserted.ops) || co.isEmpty(inserted.ops[0]))
                throw inserted;
            else{
                //deckDB.insertNewContentItem(inserted.ops[0], request.payload.position, request.payload.root_deck, 'slide');
                let content = inserted.ops[0].revisions[0].content, user = request.payload.user, slideId = inserted.ops[0]._id+'-'+1;
                if(content === ''){
                    content = '<h2>'+inserted.ops[0].revisions[0].title+'</h2>';
                }
                createThumbnail(content, slideId, user);

                reply(co.rewriteID(inserted.ops[0]));
            }
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    updateSlide: function(request, reply) {
        //NOTE shall the payload and/or response be cleaned or enhanced with values?
        let slideId = request.params.id;

        slideDB.replace(encodeURIComponent(slideId), request.payload).then((replaced) => {
            //console.log('updated: ', replaced.value.revisions);
            if (co.isEmpty(replaced.value))
                throw replaced;
            else{
                //let revisionUpdatedId = slideId.split('-')[1];
                //we must update all decks in the 'usage' attribute
                slideDB.get(replaced.value._id).then((newSlide) => {

                    //only update the root deck, i.e., direct parent
                    deckDB.updateContentItem(newSlide, '', request.payload.root_deck, 'slide');
                    newSlide.revisions = [newSlide.revisions[newSlide.revisions.length-1]];
                    let content = newSlide.revisions[0].content, user = request.payload.user, newSlideId = newSlide._id+'-'+newSlide.revisions[0].id;
                    if(content === ''){
                        content = '<h2>'+inserted.ops[0].revisions[0].title+'</h2>';
                    }
                    createThumbnail(content, newSlideId, user);
                    reply(newSlide);

                }).catch((error) => {
                    request.log('error', error);
                    reply(boom.badImplementation());
                });

                //reply(replaced.value);
            }
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    updateNoRevisionSlide: function(request, reply) {
        //NOTE shall the payload and/or response be cleaned or enhanced with values?
        let slideId = request.params.id;

        slideDB.replaceNoRevision(encodeURIComponent(slideId), request.payload).then((replaced) => {
            //console.log('updated: ', replaced);
            if (co.isEmpty(replaced))
                throw replaced;
            else{
                // slideDB.get(replaced.value._id).then((newSlide) => {
                //   deckDB.updateContentItem(newSlide, '', request.payload.root_deck, 'slide');
                // });

                reply(replaced.value);
            }
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    revertSlideRevision: function(request, reply) {
        slideDB.get(encodeURIComponent(request.params.id.split('-')[0]), request.payload).then((slide) => {
            if (co.isEmpty(slide))
                throw slide;
            else{
                let revision_id = parseInt(request.payload.revision_id);
                deckDB.updateContentItem(slide, revision_id, request.payload.root_deck, 'slide')
                .then((updatedIds) => {
                    let fullId = request.params.id;
                    if(fullId.split('-').length < 2){
                        fullId += '-'+updatedIds.old_revision;
                    }
                    slideDB.updateUsage(fullId, revision_id, request.payload.root_deck).then((updatedSlide) => {
                        let revisionArray = [updatedSlide.revisions[revision_id-1]];
                        updatedSlide.revisions = revisionArray;
                        reply(updatedSlide);
                    });

                });

            }
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    getDeck: function(request, reply) {
        deckDB.get(encodeURIComponent(request.params.id)).then((deck) => {
            if (co.isEmpty(deck))
                reply(boom.notFound());
            else
            reply(deck);
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },
    newDeck: function(request, reply) {
        //NOTE shall the response be cleaned or enhanced with values?
        deckDB.insert(request.payload).then((inserted) => {
            if (co.isEmpty(inserted.ops) || co.isEmpty(inserted.ops[0]))
                throw inserted;
            else{
                //create a new slide inside the new deck
                //console.log('inserted', inserted);

                let newSlide = {
                    'title': 'New slide',
                    'content': '',
                    'language': 'en',
                    'license': request.payload.license,
                    //NOTE user_id should be retrieved from the frontend
                    'user': inserted.ops[0].user,
                    'root_deck': String(inserted.ops[0]._id)+'-1',
                    'position' : 1
                };

                if(request.payload.hasOwnProperty('first_slide')){
                    if(request.payload.first_slide.hasOwnProperty('content')){
                        newSlide.content = request.payload.first_slide.content;
                    }
                    if(request.payload.first_slide.hasOwnProperty('title')){
                        newSlide.title = request.payload.first_slide.title;
                    }
                    if(request.payload.first_slide.hasOwnProperty('speakernotes')){
                        newSlide.speakernotes = request.payload.first_slide.speakernotes;
                    }
                }

                //console.log('slide', newSlide);
                slideDB.insert(newSlide)
                .then((insertedSlide) => {
                    //console.log('inserted_slide', insertedSlide);
                    insertedSlide.ops[0].id = insertedSlide.ops[0]._id;
                    deckDB.insertNewContentItem(insertedSlide.ops[0], 0, newSlide.root_deck, 'slide')
                    .then((insertedContentItem) => {
                        // if(typeof request.payload.root_deck !== 'undefined')
                        //   deckDB.insertNewContentItem(inserted.ops[0], request.payload.position, request.payload.root_deck, 'deck');
                        reply(co.rewriteID(inserted.ops[0]));
                    });
                    let content = newSlide.content, user = inserted.ops[0].user, slideId = insertedSlide.ops[0].id+'-'+1;
                    if(content === ''){
                        content = '<h2>'+newSlide.title+'</h2>';
                    }
                    createThumbnail(content, slideId, user);
                });
                //check if a root deck is defined, if yes, update its content items to reflect the new sub-deck

            }
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    updateDeck: function(request, reply) {
        //NOTE shall the payload and/or response be cleaned or enhanced with values?
        //or should be deckDB.replace?
        let deckId = request.params.id;
        deckDB.update(encodeURIComponent(deckId.split('-')[0]), request.payload).then((replaced) => {
            //console.log('updated: ', replaced);
            if (co.isEmpty(replaced.value))
                throw replaced;
            else
            reply(replaced.value);
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    updateDeckRevision: function(request, reply) {
        //NOTE shall the payload and/or response be cleaned or enhanced with values?
        if(request.payload.new_revision){
            deckDB.replace(encodeURIComponent(request.params.id), request.payload).then((replaced) => {
                if (co.isEmpty(replaced.value))
                    throw replaced;
                else{
                    deckDB.get(replaced.value._id).then((newDeck) => {
                        if(request.payload.root_deck){
                            deckDB.updateContentItem(newDeck, '', request.payload.root_deck, 'deck')
                            .then((updated) => {
                                newDeck.revisions = [newDeck.revisions[newDeck.revisions.length-1]];
                                reply(newDeck);
                            });
                        }
                        else{
                            //reply(replaced.value);
                            newDeck.revisions = [newDeck.revisions[newDeck.revisions.length-1]];
                            reply(newDeck);
                        }
                    });

                }
            }).catch((error) => {
                request.log('error', error);
                reply(boom.badImplementation());
            });
        }
        else{
            deckDB.update(encodeURIComponent(request.params.id), request.payload).then((replaced) => {
                if (co.isEmpty(replaced.value))
                    throw replaced;
                else
                reply(replaced.value);
            }).catch((error) => {
                request.log('error', error);
                reply(boom.badImplementation());
            });
        }

    },

    forkDeckRevision: function(request, reply) {
        //NOTE shall the payload and/or response be cleaned or enhanced with values?
        deckDB.get(encodeURIComponent(request.params.id)).then((existingDeck) => {
            let ind = existingDeck.revisions.length-1;
            let payload = {
                title: existingDeck.revisions[ind].title,
                description: existingDeck.description,
                language: existingDeck.revisions[ind].language,
                tags: existingDeck.revisions[ind].tags,
                license: existingDeck.license,
                user: request.payload.user,
                fork: true
            };
            //console.log(payload);
            deckDB.replace(encodeURIComponent(request.params.id), payload).then((replaced) => {
                if (co.isEmpty(replaced.value))
                    throw replaced;
                else{
                    deckDB.get(replaced.value._id).then((newDeck) => {
                        newDeck.revisions = [newDeck.revisions[newDeck.revisions.length-1]];
                        reply(newDeck);
                    });
                }
            }).catch((error) => {
                request.log('error', error);
                reply(boom.badImplementation());
            });
        });

    },

    // revertDeckRevision: function(request, reply) {
    //     deckDB.revert(encodeURIComponent(request.params.id), request.payload).then((reverted) => {
    //         if (co.isEmpty(reverted))
    //             throw reverted;
    //         else{
    //             if(reverted.value.deck !== null){
    //                 deckDB.updateContentItem(reverted.value, parseInt(request.payload.revision_id), reverted.value.deck, 'deck');
    //             }
    //             reply(reverted);
    //         }
    //     }).catch((error) => {
    //         request.log('error', error);
    //         reply(boom.badImplementation());
    //     });
    // },

    revertDeckRevision: function(request, reply) {
        if(request.payload.root_deck === null || !request.payload.hasOwnProperty('root_deck') || request.payload.root_deck.split('-')[0] === request.params.id.split('-')[0] ){
            deckDB.revert(encodeURIComponent(request.params.id), request.payload).then((reverted) => {
                if (co.isEmpty(reverted))
                    throw reverted;
                else{
                    reverted.value.revisions = [reverted.value.revisions[parseInt(request.payload.revision_id)-1]];
                    reply(reverted.value);
                }
            }).catch((error) => {
                request.log('error', error);
                reply(boom.badImplementation());
            });
        }
        else{
            deckDB.get(encodeURIComponent(request.params.id.split('-')[0]), request.payload).then((deck) => {
                if (co.isEmpty(deck))
                    throw deck;
                else{
                    let revision_id = parseInt(request.payload.revision_id);
                    deckDB.updateContentItem(deck, revision_id, request.payload.root_deck, 'deck')
                    .then((updatedIds) => {
                        let fullId = request.params.id;
                        if(fullId.split('-').length < 2){
                            fullId += '-'+updatedIds.old_revision;
                        }
                        deckDB.updateUsage(fullId, revision_id, request.payload.root_deck).then((updatedDeck) => {
                            let revisionArray = [updatedDeck.revisions[revision_id-1]];
                            updatedDeck.revisions = revisionArray;
                            reply(updatedDeck);
                        });

                    });

                }
            }).catch((error) => {
                request.log('error', error);
                reply(boom.badImplementation());
            });
        }

    },

    //decktree
    getDeckTree: function(request, reply) {
        deckDB.getDeckTreeFromDB(request.params.id)
        .then((deckTree) => {
            if (co.isEmpty(deckTree))
                reply(boom.notFound());
            else{
                reply(deckTree);
            }
        });
    },

    createDeckTreeNode: function(request, reply) {
        //----mockup:start
        let node = {};
        //let rnd = Math.round(Math.random()*800) + 1;

        if(request.payload.nodeSpec.type === 'slide'){
            if(request.payload.nodeSpec.id && request.payload.nodeSpec.id !== '0'){
                //it means it is an existing node, we should retrieve the details then
                let spath = request.payload.selector.spath;
                let spathArray = spath.split(';');
                let parentID, parentPosition, slidePosition;
                if(spathArray.length > 1){

                    let parentArrayPath = spathArray[spathArray.length-2].split(':');
                    parentID = parentArrayPath[0];
                    parentPosition = parseInt(parentArrayPath[1]);

                }
                else{
                    parentID = request.payload.selector.id;
                }

                let slideArrayPath = spathArray[spathArray.length-1].split(':');
                slidePosition = parseInt(slideArrayPath[1])+1;
                let slideRevision = parseInt(request.payload.nodeSpec.id.split('-')[1])-1;
                module.exports.getSlide({'params' : {'id' : request.payload.nodeSpec.id.split('-')[0]}}, (slide) => {
                    if(request.payload.nodeSpec.id === request.payload.selector.sid){
                        //we must duplicate the slide
                        let duplicateSlide = slide;
                        duplicateSlide.parent = request.payload.nodeSpec.id;
                        duplicateSlide.comment = 'Duplicate slide of ' + request.payload.nodeSpec.id;
                        //copy the slide to a new duplicate
                        slideDB.copy(duplicateSlide, slideRevision)
                        .then((insertedDuplicate) => {
                            //console.log(insertedDuplicate);
                            insertedDuplicate = insertedDuplicate.ops[0];
                            insertedDuplicate.id = insertedDuplicate._id;
                            //node = {title: insertedDuplicate.revisions[slideRevision].title, id: insertedDuplicate.id+'-'+insertedDuplicate.revisions[slideRevision].id, type: 'slide'};
                            node = {title: insertedDuplicate.revisions[0].title, id: insertedDuplicate.id+'-'+insertedDuplicate.revisions[0].id, type: 'slide'};
                            deckDB.insertNewContentItem(insertedDuplicate, slidePosition, parentID, 'slide', 1);
                            reply(node);
                        });
                    }
                    else{
                        //change position of the existing slide
                        deckDB.insertNewContentItem(slide, slidePosition, parentID, 'slide', slideRevision+1);
                        node = {title: slide.revisions[slideRevision].title, id: slide.id+'-'+slide.revisions[slideRevision].id, type: 'slide'};
                        reply(node);
                    }

                });

            }else{
                //need to make a new slide
                let spath = request.payload.selector.spath;
                let spathArray = spath.split(';');
                let parentID, parentPosition, slidePosition;
                if(spathArray.length > 1){

                    let parentArrayPath = spathArray[spathArray.length-2].split(':');
                    parentID = parentArrayPath[0];
                    parentPosition = parseInt(parentArrayPath[1]);

                }
                else{
                    parentID = request.payload.selector.id;
                }
                let slideArrayPath = spathArray[spathArray.length-1].split(':');
                slidePosition = parseInt(slideArrayPath[1])+1;
                if(request.payload.selector.stype === 'deck'){
                    //selector is deck, we can get the root deck id directly
                    parentID = request.payload.selector.sid;
                    slidePosition = 0;
                }


                //NOTE we should call /slide/new
                let slide = {
                    'title': 'New slide', //NOTE add title
                    'content': '',
                    'language': 'en',
                    'license': 'CC0',
                    //NOTE user_id should be retrieved from the frontend
                    'user': request.payload.user,
                    'root_deck': parentID,
                    'position' : slidePosition
                };

                if(request.payload.hasOwnProperty('content')){
                    slide.content = request.payload.content;
                }
                if(request.payload.hasOwnProperty('title')){
                    slide.title = request.payload.title;
                }
                if(request.payload.hasOwnProperty('license')){
                    slide.license = request.payload.license;
                }
                if(request.payload.hasOwnProperty('speakernotes')){
                    slide.speakernotes = request.payload.speakernotes;
                }

                //NOTE update positions accordingly
                module.exports.newSlide({'payload' : slide}, (createdSlide) => {
                    node = {title: createdSlide.revisions[0].title, id: createdSlide.id+'-'+createdSlide.revisions[0].id, type: 'slide'};
                    deckDB.insertNewContentItem(createdSlide, slidePosition, parentID, 'slide');
                    //we have to return from the callback, else empty node is returned because it is updated asynchronously
                    reply(node);
                });


            }
        }else{
            if(request.payload.nodeSpec.id && request.payload.nodeSpec.id !== '0'){
                //it means it is an existing node
                let spath = request.payload.selector.spath;
                let spathArray = spath.split(';');
                let parentID, parentPosition, deckPosition;
                if(spathArray.length > 1){

                    let parentArrayPath = spathArray[spathArray.length-2].split(':');
                    parentID = parentArrayPath[0];
                    parentPosition = parseInt(parentArrayPath[1]);

                }
                else{
                    parentID = request.payload.selector.id;
                }

                let deckArrayPath = spathArray[spathArray.length-1].split(':');
                deckPosition = parseInt(deckArrayPath[1])+1;
                let deckRevision = parseInt(request.payload.nodeSpec.id.split('-')[1])-1;

                module.exports.getDeck({'params': {'id' : request.payload.nodeSpec.id}}, (deck) => {
                    deckDB.insertNewContentItem(deck, deckPosition, parentID, 'deck', deckRevision+1);
                    //we have to return from the callback, else empty node is returned because it is updated asynchronously
                    module.exports.getDeckTree({'params': {'id' : deck.id}}, (deckTree) => {
                        reply(deckTree);
                    });

                });


            }else{

                //need to make a new deck
                let spath = request.payload.selector.spath;
                let spathArray = spath.split(';');
                let parentID, parentPosition, deckPosition;
                if(spathArray.length > 1){

                    let parentArrayPath = spathArray[spathArray.length-2].split(':');
                    parentID = parentArrayPath[0];
                    parentPosition = parseInt(parentArrayPath[1]);

                }
                else{
                    parentID = request.payload.selector.id;
                }
                if(request.payload.selector.stype === 'deck'){
                    parentID = request.payload.selector.sid;
                }

                let deckArrayPath = spathArray[spathArray.length-1].split(':');
                deckPosition = parseInt(deckArrayPath[1])+1;
                //NOTE we should call /slide/new
                let deck = {
                    'description': '',
                    'title': 'New deck', //NOTE add title
                    'content': '',
                    'language': 'en',
                    'license': 'CC0',
                    //NOTE user_id should be retrieved from the frontend
                    'user': request.payload.user,
                    'root_deck': parentID,
                    'position' : deckPosition
                };

                //NOTE update positions accordingly
                module.exports.newDeck({'payload' : deck}, (createdDeck) => {
                    if(typeof parentID !== 'undefined')
                        deckDB.insertNewContentItem(createdDeck, deckPosition, parentID, 'deck');
                    //we have to return from the callback, else empty node is returned because it is updated asynchronously
                    module.exports.getDeckTree({'params': {'id' : createdDeck.id}}, (deckTree) => {
                        reply(deckTree);
                    });

                });
            }
        }
        //----mockup:end
        //reply(node);
    },

    renameDeckTreeNode: function(request, reply) {
        //NOTE check if it is deck or slide
        if(request.payload.selector.stype === 'deck'){
            deckDB.rename(encodeURIComponent(request.payload.selector.sid), request.payload.name).then((renamed) => {
                if (co.isEmpty(renamed.value))
                    throw renamed;
                else
                reply(renamed.value);
            }).catch((error) => {
                request.log('error', error);
                reply(boom.badImplementation());
            });
        }else {
            slideDB.rename(encodeURIComponent(request.payload.selector.sid), request.payload.name).then((renamed) => {
                if (co.isEmpty(renamed.value))
                    throw renamed;
                else
                reply(renamed.value);
            }).catch((error) => {
                request.log('error', error);
                reply(boom.badImplementation());
            });
        }

        //reply({'msg': 'node name got updated. New node name is: ' + request.payload.name});
    },

    deleteDeckTreeNode: function(request, reply) {
        //NOTE no removal in the DB, just unlink from content items, and update the positions of the other elements
        let spath = request.payload.selector.spath;
        let spathArray = spath.split(';');
        let parentID, parentPosition, itemPosition;
        if(spathArray.length > 1){

            let parentArrayPath = spathArray[spathArray.length-2].split(':');
            parentID = parentArrayPath[0];
            parentPosition = parentArrayPath[1];

        }
        else{
            parentID = request.payload.selector.id;
        }

        let itemArrayPath = spathArray[spathArray.length-1].split(':');
        itemPosition = itemArrayPath[1];
        //NOTE removes item in given position -- do we have to validate with sid ?
        deckDB.removeContentItem(itemPosition, parentID)
        .then((removed) => {
            reply(removed);
        });
    },

    getFlatSlides: function(request, reply){
        deckDB.getFlatSlidesFromDB(request.params.id, undefined)
        .then((deckTree) => {
            if(typeof request.query.limit !== 'undefined' || typeof request.query.offset !== 'undefined'){
                let limit = request.query.limit, offset = request.query.offset;
                if(typeof limit !== 'undefined'){
                    limit = parseInt(limit);
                    if(limit < 0 || limit > deckTree.children.length || isNaN(limit))
                        limit = deckTree.children.length;
                }
                else{
                    limit = deckTree.children.length;
                }

                if(typeof offset !== 'undefined'){
                    offset = parseInt(offset);
                    if(offset < 0 || offset >= deckTree.children.length)
                        offset = 0;
                }
                else{
                    offset = 0;
                }


                let ending = parseInt(offset)+parseInt(limit);
                deckTree.children = deckTree.children.slice(offset, ending);
            }

            reply(deckTree);
        });
    },

    getEditors: function(request, reply){
        deckDB.getDeckEditors(request.params.id)
        .then((editorsList) => {
            reply(editorsList);
        });
    },

    needsNewRevision: function(request, reply){
        deckDB.needsNewRevision(request.params.id, request.query.user).then((needsNewRevision) => {
            //console.log(needsNewRevision);
            reply(needsNewRevision);
        });
    },

    handleChange: function(request, reply){
        deckDB.get(request.params.id).then((foundDeck) => {
            let active = -1;
            let idArray = request.params.id.split('-');
            if(idArray.length > 1){
                active = idArray[1];
            }
            else{
                active = foundDeck.active;
            }
            request.params.id = idArray[0]+'-'+active;
            deckDB.get(request.query.root_deck).then((foundRootDeck) => {
                let activeRoot = -1;
                let rootIdArray = request.query.root_deck.split('-');
                if(rootIdArray.length > 1){
                    activeRoot = rootIdArray[1];
                }
                else{
                    activeRoot = parseInt(foundRootDeck.active);
                }
                request.query.root_deck = rootIdArray[0]+'-'+activeRoot;
                //console.log('deck', request.params.id);
                //console.log('root_deck', request.query.root_deck);
                module.exports.getDeckTree({'params': {'id' : request.query.root_deck}}, (decktree) => {
                    deckDB.handleChange(decktree, request.params.id, request.query.root_deck, request.query.user).then((changeSet) => {
                        //console.log(changeSet);
                        if(!changeSet){
                            throw changeSet;
                        }
                        else{
                            reply(changeSet);
                        }
                    }).catch((e) => {
                        request.log('error', e);
                        reply(boom.badImplementation());
                    });;
                });
            }).catch((err) => {
                request.log('error', err);
                reply(boom.badImplementation());
            });;

        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

    //returns metadata about all decks a user owns
    getAllDecks: (request, reply) => {
        //TODO another API for user activity is needed

        //parse userid
        let userid = request.params.userid;
        const integerSchema = Joi.number().integer();
        const validationResult = integerSchema.validate(userid);
        if (validationResult.error === null) {
            userid = validationResult.value;
        }

        let decksPromise = deckDB.find('decks', {
            user: userid
        });

        decksPromise.then((decks) => {
            console.log('handler getAllDecks: found decks:', decks);

            if (decks.length < 1) {
                reply(boom.notFound());
                return;
            }

            let result = [];

            decks.forEach((deck) => {
                let metadata = {};
                metadata._id = deck._id;
                metadata.timestamp = deck.timestamp;
                metadata.description = deck.description;
                metadata.language = deck.language;
                metadata.lastUpdate = deck.lastUpdate;
                metadata.tags = deck.tags;
                metadata.translation = deck.translation;
                metadata.countRevisions = deck.revisions.length;
                metadata.active = deck.active;

                //get revision
                let revision = {};
                for (let key in deck.revisions) {
                    if (deck.revisions[key].id === deck.active)
                        revision = deck.revisions[key];
                }

                metadata.timestamp = revision.timestamp;
                metadata.title = revision.title;
                metadata.comment = revision.comment;
                metadata.abstract = revision.abstract;
                metadata.license = revision.license;
                metadata.priority = revision.priority;
                metadata.visibility = revision.visibility;
                metadata.language = revision.language;
                metadata.translation = revision.translation;
                metadata.tags = revision.tags;
                metadata.parent = revision.parent;

                result.push(metadata);
            });

            return reply(result);

        });
    }


};

function createThumbnail(slideContent, slideId, user) {
    let http = require('http');
    let he = require('he');

    let encodedContent = he.encode(slideContent, {allowUnsafeSymbols: true});

    let jsonData = {
        userID: String(user),
        html: encodedContent,
        filename: slideId
    };

    let data = JSON.stringify(jsonData);

    let options = {
        host: Microservices.image.uri,
        port: Microservices.image.port,
        path: '/thumbnail',
        method: 'POST',
        headers : {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'Content-Length': data.length
        }
    };
    let req = http.request(options, (res) => {
        // console.log('STATUS: ' + res.statusCode);
        // console.log('HEADERS: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
        // console.log('Response: ', chunk);
        // let newDeckTreeNode = JSON.parse(chunk);

        // resolve(newDeckTreeNode);
        });
    });
    req.on('error', (e) => {
        console.log('problem with request thumb: ' + e.message);
        // reject(e);
    });
    req.write(data);
    req.end();

    console.log(slideId);
}
