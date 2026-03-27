import { SampleCopy } from "../../types/models";

export type SampleCopyDistributionState = {
    currentIndex: number;
    sampleCopy: SampleCopy;
};

/**
 * Handles distribution of sample copies for live conversations.
 * This component is scoped to a single conversations and manages the distribution 
 * of sample copies across stages.
 */
export class SampleCopyDistributor {
    private copyStates: Record<string, SampleCopyDistributionState> = {};

    constructor(private originalCopies: SampleCopy[]) {
        this.copyStates = originalCopies.reduce((acc, copy) => {
            acc[copy.id] = { currentIndex: 0, sampleCopy: copy };
            return acc;
        }, {} as Record<string, SampleCopyDistributionState>);
    }
    
    /**
     * Returns the original sample copies that were provided to the distributor. This can be used for reference or debugging purposes.
     */
    getOriginalCopies(): SampleCopy[] {
        return this.originalCopies;
    }

    /**
     * Returns true if a sample copy with the given ID is known to this distributor.
     * @param sampleCopyId The ID to check
     */
    hasId(sampleCopyId: string): boolean {
        return sampleCopyId in this.copyStates;
    }

    /**
     * Distributes copies for a given sample copy ID based on its sampling method and amount.
     * @param sampleCopyId The ID of the sample copy to distribute copies for
     * @returns An array of copies to be used for the current turn
     */
    distributeCopies(sampleCopyId: string): string[] {
        const copyState = this.copyStates[sampleCopyId];
        if (!copyState) {
            throw new Error(`Sample copy with ID ${sampleCopyId} not found in distributor`);
        }

        const targetLength = copyState.sampleCopy.amount;
        if (copyState.sampleCopy.samplingMethod === 'random') {
            return this.getRandomSample(copyState.sampleCopy.content, targetLength);
        } else if (copyState.sampleCopy.samplingMethod === 'round_robin') {
            return this.getRoundRobinSample(copyState, targetLength);
        } else {
            throw new Error(`Unsupported sampling method: ${copyState.sampleCopy.samplingMethod}`);
        }
    }

    /**
     * Returns a random sample of copies from the given array.
     * @param copies The array of copies to sample from
     * @param targetLength The number of copies to return
     * @returns An array of randomly selected copies
     */
    private getRandomSample(copies: string[], targetLength: number): string[] {
        const shuffled = [...copies].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, targetLength);
    }

    /**
     * Returns a round-robin sample of copies from the given array.
     * @param copyState The state of the sample copy distribution
     * @param targetLength The number of copies to return
     * @returns An array of copies selected in a round-robin manner
     */
    private getRoundRobinSample(copyState: SampleCopyDistributionState, targetLength: number): string[] {
        const { sampleCopy, currentIndex } = copyState;
        const copies = sampleCopy.content;
        const result: string[] = [];

        for (let i = 0; i < targetLength; i++) {
            result.push(copies[currentIndex]);
            copyState.currentIndex = (copyState.currentIndex + 1) % copies.length;
        }

        return result;
    }
}