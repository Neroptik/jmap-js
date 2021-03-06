// -------------------------------------------------------------------------- \\
// File: Thread.js                                                            \\
// Module: MailModel                                                          \\
// Requires: API, Message.js                                                  \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const meta = O.meta;
const Class = O.Class;
const ObservableArray = O.ObservableArray;
const Record = O.Record;
const READY = O.Status.READY;

const Message = JMAP.Message;

// ---

const isInTrash = function ( message ) {
    return message.is( READY ) && message.get( 'isInTrash' );
};
const isInNotTrash = function ( message ) {
    return message.is( READY ) && message.get( 'isInNotTrash' );
};

const aggregateBoolean = function ( _, key ) {
    return this.get( 'messages' ).reduce(
    function ( isProperty, message ) {
        return isProperty || message.get( key );
    }, false );
}.property( 'messages' ).nocache();

const aggregateBooleanInNotTrash = function ( _, key ) {
    key = key.slice( 0, -10 );
    return this.get( 'messagesInNotTrash' ).reduce(
    function ( isProperty, message ) {
        return isProperty || message.get( key );
    }, false );
}.property( 'messages' ).nocache();

const aggregateBooleanInTrash = function ( _, key ) {
    key = key.slice( 0, -7 );
    return this.get( 'messagesInTrash' ).reduce(
    function ( isProperty, message ) {
        return isProperty || message.get( key );
    }, false );
}.property( 'messages' ).nocache();

const total = function( property ) {
    return function () {
        return this.get( property ).get( 'length' );
    }.property( 'messages' ).nocache();
};

// senders is [{name: String, email: String}]
const toFrom = function ( message ) {
    var from = message.get( 'from' );
    return from && from[0] || null;
};
const senders = function( property ) {
    return function () {
        return this.get( property )
                   .map( toFrom )
                   .filter( O.Transform.toBoolean );
    }.property( 'messages' ).nocache();
};

const sumSize = function ( size, message ) {
    return size + ( message.get( 'size' ) || 0 );
};
const size = function( property ) {
    return function () {
        return this.get( property ).reduce( sumSize, 0 );
    }.property( 'messages' ).nocache();
};

const Thread = Class({

    Extends: Record,

    messages: Record.toMany({
        recordType: Message,
        key: 'emailIds',
        noSync: true,
    }),

    messagesInNotTrash: function () {
        return new ObservableArray(
            this.get( 'messages' ).filter( isInNotTrash )
        );
    }.property(),

    messagesInTrash: function () {
        return new ObservableArray(
            this.get( 'messages' ).filter( isInTrash )
         );
    }.property(),

    _setMessagesArrayContent: function () {
        var cache = meta( this ).cache;
        var messagesInNotTrash = cache.messagesInNotTrash;
        var messagesInTrash = cache.messagesInTrash;
        if ( messagesInNotTrash ) {
            messagesInNotTrash.set( '[]',
                this.get( 'messages' ).filter( isInNotTrash )
            );
        }
        if ( messagesInTrash ) {
            messagesInTrash.set( '[]',
                this.get( 'messages' ).filter( isInTrash )
            );
        }
    }.observes( 'messages' ),

    isAll: function ( status ) {
        return this.is( status ) &&
            // .reduce instead of .every so we deliberately fetch every record
            // object from the store, triggering a fetch if not loaded
            this.get( 'messages' ).reduce( function ( isStatus, message ) {
                return isStatus && message.is( status );
            }, true );
    },

    // Note: API Mail mutates this value; do not cache.
    mailboxCounts: function () {
        var counts = {};
        this.get( 'messages' ).forEach( function ( message ) {
            message.get( 'mailboxes' ).forEach( function ( mailbox ) {
                var storeKey = mailbox.get( 'storeKey' );
                counts[ storeKey ] = ( counts[ storeKey ] ||  0 ) + 1;
            });
        });
        return counts;
    }.property( 'messages' ).nocache(),

    // ---

    isUnread: aggregateBoolean,
    isFlagged: aggregateBoolean,
    isDraft: aggregateBoolean,
    hasAttachment: aggregateBoolean,

    total: total( 'messages' ),
    senders: senders( 'messages' ),
    size: size( 'messages' ),

    // ---

    isUnreadInNotTrash: aggregateBooleanInNotTrash,
    isFlaggedInNotTrash: aggregateBooleanInNotTrash,
    isDraftInNotTrash: aggregateBooleanInNotTrash,
    hasAttachmentInNotTrash: aggregateBooleanInNotTrash,

    totalInNotTrash: total( 'messagesInNotTrash' ),
    sendersInNotTrash: senders( 'messagesInNotTrash' ),
    sizeInNotTrash: size( 'messagesInNotTrash' ),

    // ---

    isUnreadInTrash: aggregateBooleanInTrash,
    isFlaggedInTrash: aggregateBooleanInTrash,
    isDraftInTrash: aggregateBooleanInTrash,
    hasAttachmentInTrash: aggregateBooleanInTrash,

    totalInTrash: total( 'messagesInTrash' ),
    sendersInTrash: senders( 'messagesInTrash' ),
    sizeInTrash: size( 'messagesInTrash' )
});
Thread.__guid__ = 'Thread';
Thread.dataGroup = 'urn:ietf:params:jmap:mail';

JMAP.mail.threadChangesMaxChanges = 50;
JMAP.mail.handle( Thread, {

    fetch: function ( accountId, ids ) {
        // Called with ids == null if you try to refresh before we have any
        // data loaded. Just ignore.
        if ( ids ) {
            this.callMethod( 'Thread/get', {
                accountId: accountId,
                ids: ids,
            });
            this.callMethod( 'Email/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'Thread/get',
                    path: '/list/*/emailIds',
                },
                properties: Message.headerProperties,
            });
        }
    },

    refresh: function ( accountId, ids, state ) {
        if ( ids ) {
            this.callMethod( 'Thread/get', {
                accountId: accountId,
                ids: ids,
            });
        } else {
            this.callMethod( 'Thread/changes', {
                accountId: accountId,
                sinceState: state,
                maxChanges: this.threadChangesMaxChanges,
            });
        }
    },

    //  ---

    'Thread/get': function ( args ) {
        this.didFetch( Thread, args, false );
    },

    'Thread/changes': function ( args ) {
        this.didFetchUpdates( Thread, args, false );
        if ( args.updated && args.updated.length ) {
            this.recalculateAllFetchedWindows();
        }
        if ( args.hasMoreChanges ) {
            const threadChangesMaxChanges = this.threadChangesMaxChanges;
            if ( threadChangesMaxChanges < 150 ) {
                if ( threadChangesMaxChanges === 50 ) {
                    this.threadChangesMaxChanges = 100;
                } else {
                    this.threadChangesMaxChanges = 150;
                }
                this.fetchMoreChanges( args.accountId, Thread );
                return;
            } else {
                // We've fetched 300 updates and there's still more. Let's give
                // up and reset.
                this.response[ 'error_Thread/changes_cannotCalculateChanges' ]
                    .apply( this, arguments );
            }
        }
        this.threadChangesMaxChanges = 50;
    },

    'error_Thread/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var store = this.get( 'store' );
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Unload if possible, otherwise mark
        // obsolete.
        store.getAll( Thread ).forEach( function ( thread ) {
            if ( thread.get( 'accountId' ) === accountId ) {
                if ( !store.unloadRecord( thread.get( 'storeKey' ) ) ) {
                    thread.setObsolete();
                }
            }
        });
        this.recalculateAllFetchedWindows();
        // Tell the store we're now in the new state.
        store.sourceDidFetchUpdates(
            accountId, Thread, null, null,
            store.getTypeState( accountId, Thread ), ''
        );
    },
});

// ---

// Circular dependency
Message.prototype.thread.Type = Thread;

// --- Export

JMAP.Thread = Thread;

}( JMAP ) );
