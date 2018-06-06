'use strict';

const _ = require('lodash');
const boom = require('boom');
const async = require('async');

const util = require('../lib/util');

const auth = require('./auth');

const deckDB = require('../database/deckDatabase');
const slideDB = require('../database/slideDatabase');
const treeDB = require('../database/deckTreeDatabase');

const fileService = require('../services/file');

const slidetemplate = '<div class="pptx2html" style="position: relative; width: 960px; height: 720px;">'+

    '<div _id="2" _idx="undefined" _name="Title 1" _type="title" class="block content v-mid h-mid" style="position: absolute; top: 38.3334px; left: 66px; width: 828px; height: 139.167px; z-index: 23488;">'+
    '<h3>Title</h3></div>'+
    '<div _id="3" _idx="1" _name="Content Placeholder 2" _type="body" class="block content v-up" style="position: absolute; top: 191.667px; left: 66px; width: 828px; height: 456.833px; z-index: 23520;">'+
    '<ul>'+
    '   <li>Text bullet 1</li>'+
    '   <li>Text bullet 2</li>'+
    '</ul>'+
    '<div class="h-left">&nbsp;</div>'+
    '</div></div>';

function parseMoveSource(selector) {
    let parentId;
    let pathParts = selector.spath.split(';');
    if (pathParts.length > 1) {
        // the path ends with the item, so pick its parent
        // pick the id (first element) of the second to last path part
        [parentId] = pathParts[pathParts.length - 2].split(':');
    } else if (selector.spath) {
        // the path only has the item, so the parent is the root deck
        parentId = selector.id;
    }

    // always pick the position (second element) of the last path part
    let [,position] = pathParts[pathParts.length - 1].split(':');

    return {
        id: selector.sid,
        kind: selector.stype,
        parentId, // could be undefined
        position: position && parseInt(position), // could be undefined
    };
}

function parseMoveTarget(selector) {
    let deckId;
    if (selector.stype === 'deck') {
        deckId = selector.sid;
    } else if (selector.spath) {
        // it's a slide, with a path
        let pathParts = selector.spath.split(';');
        if (pathParts.length > 1) {
            // the path ends with the slide, so pick its parent
            // pick the id (first element) of the second to last path part
            [deckId] = pathParts[pathParts.length - 2].split(':');
        } else {
            // the path only has the slide, so the parent is the root deck
            deckId = selector.id;
        }
    } else {
        // if stype is slide and no spath, the target deck is the root of the tree
        deckId = selector.id;
    }

    return deckId;
}

async function findCreateNodeTarget(selector) {
    let target = {
        id: selector.sid || selector.id,
        kind: selector.stype,
    };

    // first parse the spath for create node target details
    if (selector.spath) {
        let parentId, position;

        let pathParts = selector.spath.split(';');
        if (pathParts.length > 1) {
            // the path ends with the node, so pick its parent
            // pick the id (first element) of the second to last path part
            [parentId] = pathParts[pathParts.length - 2].split(':');
        } else {
            // the path only has the node, so the parent is the root
            parentId = selector.id;
        }

        // always pick the position (second element) of the last path part
        [,position] = pathParts[pathParts.length - 1].split(':');

        Object.assign(target, {
            parentId,
            position: position && parseInt(position),
        });

    } else {
        // no path given; we must find its parent and its position from the db
        target = await treeDB.findDeckTreeNode(selector.id, target.id, target.kind);
    }

    // with current API if target.kind is deck,
    // we only support adding to its end (any position determined is ignored)
    // this is a UI limitation that has creeped into the API as well

    if (target.kind === 'deck') {
        // the node will be created under the target.id instead of target.parentId
        // position is ignored
        target.parentId = target.id;
        delete target.position;
    }

    return target;
}

const self = module.exports = {

    // authorize node creation and iterate nodeSpec array to apply each insert
    createDeckTreeNode: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let rootDeckId = request.payload.selector.id;

        // TODO proper authorization checking the actual parent id
        return auth.authorizeUser(userId, rootDeckId, rootDeckId).then((boomError) => {
            if (boomError) return reply(boomError);

            // support multiple decks/slides to be attached at once
            let nodeSpecs = request.payload.nodeSpec;
            if (nodeSpecs.length < 2) {
                // just one, go ahead
                request.payload.nodeSpec = nodeSpecs[0];
                return self._createDeckTreeNode(request, reply);
            }

            // do some validations for the nodeSpec array
            // all ids should be valid numbers
            if (!nodeSpecs.every((node) => node.id && node.id !== '0')) {
                return reply(boom.badData());
            }

            // check if we append at the end (no position argument) or at a position
            let reverseOrder = (request.payload.selector.stype === 'slide');
            if (reverseOrder) {
                // if we *don't* attach to the end, we need to
                // reverse the node specs because they are added right after
                // the position specified in selector, like in a stack (LIFO)
                // we would like to provide the semantics of a queue (FIFO)
                nodeSpecs.reverse();
            } else {
                // if appending to deck lets remove the spath because we always attach to the last position
                request.payload.selector.spath = '';
            }

            async.concatSeries(nodeSpecs, (nodeSpec, done) => {
                // just put this nodespec
                request.payload.nodeSpec = nodeSpec;

                self._createDeckTreeNode(request, (result) => {
                    // an error already logged
                    if (result && result.isBoom) done(result);

                    // result is not an error
                    done(null, result);
                });
            }, (err, results) => {
                if (err) {
                    // an error already logged
                    if (err.isBoom) {
                        reply(err);
                    } else {
                        // an error in this method code, not logged
                        request.log('error', err);
                        reply(boom.badImplementation());
                    }
                } else {
                    // if needed, we again reverse the results to match the node spec order
                    if (reverseOrder) results.reverse();

                    reply(results);
                }
            });
        });

    },

    // creates a node (deck or slide) into the given deck tree
    _createDeckTreeNode: function(request, reply) {
        let rootId = request.payload.selector.id;
        let userId = request.auth.credentials.userid;

        // parse the source node spec
        let source = {
            kind: request.payload.nodeSpec.type,
            rootId: request.payload.nodeSpec.root,
        };
        if (request.payload.nodeSpec.id && request.payload.nodeSpec.id !== '0') {
            source.id = request.payload.nodeSpec.id;
        }

        // parse the create node target
        findCreateNodeTarget(request.payload.selector).then((target) => {
            // check if it is a slide or a deck
            if (source.kind === 'slide') {
                // check if it's new or existing
                if (source.id) {
                    // we are attaching a copy of a slide that may or may not be in the current tree
                    // let's keep the exact action tracked
                    let addAction = 'attach';
                    if (source.id === target.id) {
                        // this means we create a slide copy and insert it after the slide in target
                        addAction = 'copy';
                    }

                    // if source.rootId is defined, means it's an external attach of a slide in a deck
                    // TODO this is kept for now but should not be used by clients as the implementation is lacking
                    if (source.rootId) {
                        // we attach the slide with its variants (translations)
                        return slideDB.findSlideNode(source.rootId, source.id).then((slideNode) => {
                            if (!slideNode) {
                                throw boom.badData(`could not find slide: ${source.id} in deck tree: ${source.rootId}`);
                            }

                            // we must duplicate the slide node
                            return slideDB.copySlideNode(source.rootId, source.id, target.parentId, userId).then((newContentItem) => {
                                return deckDB.insertContentItem(newContentItem, target.position + 1, target.parentId, userId, rootId, addAction).then((updatedDeckRevision) => {
                                    let theme = updatedDeckRevision.theme;
                                    return slideDB.getContentItemSlides(newContentItem).then((slides) => {
                                        // generate thumbnails but don't wait for it
                                        for (let slide of slides) {
                                            let newSlideId = util.toIdentifier(slide);
                                            fileService.createThumbnail(slide.content, newSlideId, theme).catch((err) => {
                                                console.warn(`could not create thumbnail for slide ${newSlideId}, error was: ${err.message}`);
                                            });
                                        }

                                        // return the node data, same as the original
                                        return { title: slideNode.slide.title, id: util.toIdentifier(newContentItem.ref), type: 'slide' };
                                    });

                                });

                            });

                        });

                    }

                    // otherwise, we keep things backwards-compatible and insert a simple slide copy.
                    // in this case the slide copy will have the same language as the deck tree we are attaching to
                    return slideDB.getSlideRevision(source.id).then((slide) => {
                        if (!slide) {
                            throw boom.badData(`could not locate slide to attach: ${source.id}`);
                        }

                        return slideDB.copy(slide, target.parentId, userId).then((inserted) => {
                            // it's slide copy, so revision is 1
                            let newContentItem = { ref: { id: inserted._id, revision: 1 }, kind: 'slide' };
                            return deckDB.insertContentItem(newContentItem, target.position + 1, target.parentId, userId, rootId, addAction).then((updatedDeckRevision) => {
                                // we can now pick the theme of the parent deck and create the thumbnail!
                                let newSlideId = util.toIdentifier(newContentItem.ref);
                                fileService.createThumbnail(inserted.revisions[0].content, newSlideId, updatedDeckRevision.theme).catch((err) => {
                                    console.warn(`could not create thumbnail for slide ${newSlideId}, error was: ${err.message}`);
                                });

                                // return the node data, same as the original
                                return { title: slide.title, id: newSlideId, type: 'slide' };
                            });
                        });
                    });
                }

                // no source.id, need to create a new slide
                let newSlidePayload = {
                    title: 'New slide',
                    content: slidetemplate,
                    markdown: '',
                    speakernotes: '',
                };
                return treeDB.createSlide(newSlidePayload, target.parentId, target.position + 1, rootId, userId).then((newContentItem) => {
                    if (!newContentItem) {
                        // could not find the target.parentId
                        throw boom.badData(`could not locate specified deck: ${target.parentId}`);
                    }

                    // slide is now inserted, so we can create the thumbnail using the (direct) parent deck theme
                    let newSlideId = util.toIdentifier(newContentItem.ref);
                    // TODO set this to proper value 
                    let theme = 'default';
                    // don't wait for it before returning
                    fileService.createThumbnail(newSlidePayload.content, newSlideId, theme).catch((err) => {
                        console.warn(`could not create thumbnail for new slide ${newSlideId}: ${err.message || err}`);
                    });

                    // return the node
                    return { title: newSlidePayload.title, id: newSlideId, type: 'slide' };
                });

            }

            // new node is a deck
            if (source.id) {
                // need to attach!
                return treeDB.attachDeckTree(source.id, target.parentId, target.position + 1, rootId, userId).then((forkResult) => {
                    if (!forkResult) {
                        // source id not found
                        throw boom.badData(`could not locate specified deck: ${source.id}`);
                    }

                    return treeDB.getDeckTree(forkResult.root_deck);

                });

            }

            // id is not specified, we need to make a new deck
            let newDeckPayload = {
                title: 'New deck',
                description: '',
            };
            return treeDB.createSubdeck(newDeckPayload, target.parentId, target.position + 1, rootId, userId).then((newContentItem) => {
                if (!newContentItem) {
                    // could not find the target.parentId
                    throw boom.badData(`could not locate specified deck: ${target.parentId}`);
                }
                // this creates an empty subdeck, let's also add a sample slide
                // init the payload from the optional first_slide object data
                let newSlidePayload = Object.assign({
                    title: 'New slide',
                    content: slidetemplate,
                    markdown: '',
                    speakernotes: '',
                }, request.payload.first_slide);

                return treeDB.createSlide(newSlidePayload, util.toIdentifier(newContentItem.ref), 0, rootId, userId).then((newSlide) => {
                    // we have to return from the callback, else empty node is returned because it is updated asynchronously
                    return treeDB.getDeckTree(newContentItem.ref.id).then((newTree) => {
                        // let's create a thumbnail but dont wait for it
                        let slideId = util.toIdentifier(newSlide.ref);
                        fileService.createThumbnail(newSlidePayload.content, slideId, newTree.theme).catch((err) => {
                            console.warn(`could not create thumbnail for new slide ${slideId}: ${err.message || err}`);
                        });

                        return newTree;
                    });
                });

            });

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);

            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    // changes position of a deck tree node inside the decktree
    moveDeckTreeNode: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let rootId = request.payload.sourceSelector.id;

        // determine the source node info
        let source = parseMoveSource(request.payload.sourceSelector);

        // determine the target deck id and node position
        let target = {
            deckId: parseMoveTarget(request.payload.targetSelector),
            position: request.payload.targetIndex,
        };

        return treeDB.moveDeckTreeNode(rootId, source, target, userId).then((contentItem) => {
            // accomodate current API
            if (source.kind === 'deck') {
                // current API returns the deck tree rooted on the deck we just moved for some reason...
                return treeDB.getDeckTree(contentItem.ref.id).then(reply);
            } else {
                // current API returns the slide node we just moved for some reason...
                let itemId = util.toIdentifier(contentItem.ref);
                return slideDB.findSlideNode(rootId, itemId).then((slideNode) => {
                    reply({ title: slideNode.slide.title, id: itemId, type: 'slide' });
                });
            }

        }).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    // renames a decktree node (slide or deck)
    renameDeckTreeNode: function(request, reply) {
        let userId = request.auth.credentials.userid;
        // TODO apply authorization

        // TODO check if node exists
        let {id: rootId, sid: itemId, stype: itemKind} = request.payload.selector;
        let variantFilter = _.pick(request.payload, 'language');
        let newName = request.payload.name;

        // check if it is a deck or a slide
        let renamePromise;
        if (itemKind === 'deck') {
            renamePromise = deckDB.rename(itemId, newName, variantFilter, rootId, userId).then(() => {
                reply({ title: newName });
            });
        } else {
            // it's a slide
            renamePromise = slideDB.findSlideNode(rootId, itemId).then((slideNode) => {
                if (!slideNode) {
                    throw boom.badData(`could not find slide: ${itemId} in deck tree: ${rootId}`);
                }

                // prepare the payload and include the variant spec data as well
                let payload = Object.assign({ title: newName }, variantFilter);
                return slideDB.updateSlideNode(slideNode, payload, userId).then((newSlideRef) => {
                    // TODO revise this weird API response
                    // this is to keep the API intact as much as possible
                    return slideDB.get(newSlideRef.id).then((updatedSlide) => {
                        // prepare the updatedSlide response object
                        // updatedSlide.revisions = updatedSlide.revisions.slice(-1);
                        updatedSlide.revisions = [_.find(updatedSlide.revisions, { id: newSlideRef.revision })];

                        // create thumbnail for the new slide revision
                        let content = updatedSlide.revisions[0].content;
                        let newSlideId = util.toIdentifier(newSlideRef);

                        if (!content) {
                            content = '<h2>' + updatedSlide.revisions[0].title + '</h2>';
                        }
                        fileService.createThumbnail(content, newSlideId, newSlideRef.theme).catch((err) => {
                            console.warn(`could not create thumbnail for updated slide ${newSlideId}: ${err.message || err}`);
                        });

                        // TODO might also need to create a thumbnail
                        reply(updatedSlide);
                    });
                });
            });
        }

        // handle errors with promise
        renamePromise.catch((error) => {
            if (error.isBoom) return reply(error);
            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

    exportDeckTree: function(request, reply) {
        treeDB.exportDeckTree(request.params.id).then((deckTree) => {
            if (!deckTree) throw boom.notFound();
            reply(deckTree);
        }).catch((err) => {
            if(err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

};
