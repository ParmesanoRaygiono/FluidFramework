/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    ConnectionState,
    FileMode,
    IDocumentStorageService,
    ISequencedDocumentMessage,
    ISnapshotTree,
    ITree,
    MessageType,
    TreeEntry,
} from "@prague/container-definitions";
import { IChannel, IChannelAttributes, IEnvelope } from "@prague/runtime-definitions";
import { ChannelDeltaConnection } from "./channelDeltaConnection";
import { ChannelStorageService } from "./channelStorageService";

export interface IChannelContext {
    getChannel(): Promise<IChannel>;

    changeConnectionState(value: ConnectionState, clientId: string);

    prepareOp(message: ISequencedDocumentMessage, local: boolean): Promise<any>;

    processOp(message: ISequencedDocumentMessage, local: boolean, context: any): void;

    snapshot(): Promise<ITree>;

    isRegistered(): boolean;
}

export function createServiceEndpoints(
    id: string,
    connectionState: ConnectionState,
    submitFn: (type: MessageType, content: any) => number,
    storageService: IDocumentStorageService,
    tree: ISnapshotTree,
    extraBlobs?: Map<string, string>,
) {
    const deltaConnection = new ChannelDeltaConnection(
        id,
        connectionState,
        (message) => {
            const envelope: IEnvelope = { address: id, contents: message };
            return submitFn(MessageType.Operation, envelope);
        });
    const objectStorage = new ChannelStorageService(tree, storageService, extraBlobs);

    return {
        deltaConnection,
        objectStorage,
    };
}

export function snapshotChannel(channel: IChannel, baseId: string) {
    const snapshot = channel.snapshot();

    // Add in the object attributes to the returned tree
    const objectAttributes: IChannelAttributes = {
        snapshotFormatVersion: channel.snapshotFormatVersion,
        type: channel.type,
    };
    snapshot.entries.push({
        mode: FileMode.File,
        path: ".attributes",
        type: TreeEntry[TreeEntry.Blob],
        value: {
            contents: JSON.stringify(objectAttributes),
            encoding: "utf-8",
        },
    });

    // If baseId exists then the previous snapshot is still valid
    snapshot.id = baseId;

    return snapshot;
}
