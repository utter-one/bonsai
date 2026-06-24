export class RingBuffer {
  private buffer: Int16Array;
  private capacity: number;
  private writeIndex: number = 0;
  private isFull: boolean = false;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Int16Array(capacity);
  }

  push(chunk: Buffer): void {
    const data = new Int16Array(chunk);

    const dataLength = data.length;
    if (dataLength >= this.capacity) {
      // If incoming data exceeds capacity, keep only the last part
      this.buffer.set(data.subarray(dataLength - this.capacity));
      this.writeIndex = 0;
      this.isFull = true;
    } else {
      const spaceAtEnd = this.capacity - this.writeIndex;
      if (dataLength <= spaceAtEnd) {
        this.buffer.set(data, this.writeIndex);
        this.writeIndex += dataLength;
      } else {
        // Wrap around
        this.buffer.set(data.subarray(0, spaceAtEnd), this.writeIndex);
        this.buffer.set(data.subarray(spaceAtEnd), 0);
        this.writeIndex = dataLength - spaceAtEnd;
        this.isFull = true;
      }
    }
  }

  getContents(): Buffer {
    if (!this.isFull) {
      return Buffer.from(this.buffer.subarray(0, this.writeIndex));
    } else {
      const result = new Int16Array(this.capacity);
      const endPartLength = this.capacity - this.writeIndex;
      result.set(this.buffer.subarray(this.writeIndex), 0);
      result.set(this.buffer.subarray(0, this.writeIndex), endPartLength);
      return Buffer.from(result);
    }
  }

  clear(): void {
    this.writeIndex = 0;
    this.isFull = false;
  }
}