/**
 * ASR (Automatic Speech Recognition) provider module
 * Exports all ASR-related types, interfaces, and implementations
 */

// Core interfaces and types
export type { IAsrProvider, TextRecognitionCallback, AsrServiceErrorCallback, TextChunk } from './IAsrProvider';

// Base class
export { AsrProviderBase } from './AsrProviderBase';

// Provider implementations
export { AzureAsrProvider } from './AzureAsrProvider';
export type { AzureAsrProviderConfig } from './AzureAsrProvider';

// Factory
export { AsrProviderFactory } from './AsrProviderFactory';
export type { AsrProviderApiType } from './AsrProviderFactory';

