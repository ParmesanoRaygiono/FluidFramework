/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { AnchorSet, Delta } from "../tree";
import { ChangeFamily } from "./changeFamily";

export interface ProgressiveEditBuilder<TChange> {
    /**
     * @returns a copy of the internal change list so far.
     */
    getChanges(): TChange[];
}

export abstract class ProgressiveEditBuilderBase<TChange>
    implements ProgressiveEditBuilder<TChange>
{
    private readonly changes: TChange[] = [];
    constructor(
        private readonly changeFamily: ChangeFamily<unknown, TChange>,
        private readonly deltaReceiver: (delta: Delta.Root) => void,
        private readonly anchorSet: AnchorSet,
    ) {}

    /**
     * Subclasses add editing methods which call this with their generated edits.
     *
     * @sealed
     */
    protected applyChange(change: TChange): void {
        this.changes.push(change);
        this.changeFamily.rebaser.rebaseAnchors(this.anchorSet, change);
        const delta = this.changeFamily.intoDelta(change);
        this.deltaReceiver(delta);
    }

    /**
     * {@inheritDoc (ProgressiveEditBuilder:interface).getChanges}
     * @sealed
     */
    public getChanges(): TChange[] {
        return [...this.changes];
    }
}
