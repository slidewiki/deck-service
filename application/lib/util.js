'use strict';

// updates the elements in original by assigning values from update using id property to match elements in arrays
let self = module.exports = {
    assignToAllById: function(original, update) {
        original.forEach((val) => {
            // if not found does nothing :)
            Object.assign(val, update.find((el) => el.id === val.id) );
        });
        return original;
    },

    // find fileservice media in html or text
    findMedia: function(text, mediaType){
        let mediaExtension;

        // specify file extensions for earch media type
        if(mediaType === 'pictures')
            mediaExtension = 'png|jpeg|jpg|gif||bmp|tiff';
        else if(mediaType === 'video')
            mediaExtension = 'avi|flv|mpg|mpeg|mp4|wmv';
        else if(mediaType === 'audio')
            mediaExtension = 'mp3|wav|wma';

        let urlRegex = new RegExp(`(https?:\\/\\/fileservice[^\\s]+(${mediaExtension}))`, 'g');
        let matchArray;
        let pictures = [];

        while( (matchArray = urlRegex.exec(text)) !== null ){
            pictures.push(matchArray[0].replace(/"/g, ''));     // remove trailing quote
        }

        return pictures;
    }
};
