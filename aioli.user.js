// =============================================================================
// Custom user configuration
// =============================================================================

// Callbacks that need to be called within the WebWorker are defined here since
// functions cannot be passed to WebWorkers.
CALLBACKS = {
    "isValidFastqChunk": function(chunk)
    {
        chunk = chunk.split("\n");
        if(chunk.length < 4)
            return false;

        // Valid FASTQ:
        // - Header line must start with @
        // - Sequence and quality lines must be of equal lengths
        return chunk[0].match(/^@/) && chunk[1].length == chunk[3].length;
    }
};
