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

    // find fileservice pictures in html or text
    findPictures: function(text){
        let urlRegex = /(https?:\/\/fileservice[^\s]+(png|jpeg|jpg))/g;
        let matchArray;
        let pictures = [];

        while( (matchArray = urlRegex.exec(text)) !== null ){
            pictures.push(matchArray[0]);
        }

        return pictures;
    }
};
