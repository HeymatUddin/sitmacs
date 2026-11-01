const fs = require("node:fs/promises");

async function submitFileForScan(filePath) {
    const apiKey = process.env.VIRUSTOTAL_API_KEY?.trim();

    if (!apiKey) {
        throw new Error("VirusTotal API key is not configured");
    }

    const contents = await fs.readFile(filePath);

    if (contents.length === 0 || contents.length > 5 * 1024 * 1024) {
        throw new Error("Scan file must be between 1 byte and 5 MB");
    }

    const body = new FormData();

    body.append(
        "file",
        new Blob([contents], {
            type: "application/octet-stream",
        }),
        "sample.bin"
    );

    const response = await fetch(
        "https://www.virustotal.com/api/v3/files",
        {
            method: "POST",
            headers: {
                "x-apikey": apiKey,
            },
            body,
            signal: AbortSignal.timeout(60000),
        }
    );

    if (!response.ok) {
        const error = new Error(
            response.status === 429
                ? "VirusTotal request quota reached. Try again later."
                : "VirusTotal submission failed"
        );

        error.code = `VT_HTTP_${response.status}`;
        throw error;
    }

    const result = await response.json();
    const analysisId = result.data?.id;

    if (
        result.data?.type !== "analysis" ||
        typeof analysisId !== "string" ||
        !analysisId ||
        analysisId.length > 255
    ) {
        throw new Error("VirusTotal returned an invalid analysis ID");
    }

    return {
        engine: "VirusTotal",
        analysisId,
    };
}
async function getScanAnalysis(analysisId) {
    const apiKey = process.env.VIRUSTOTAL_API_KEY?.trim();

    if (!apiKey) {
        throw new Error("VirusTotal API key is not configured");
    }

    if (
        typeof analysisId !== "string" ||
        !analysisId ||
        analysisId.length > 255
    ) {
        throw new Error("Invalid analysis ID");
    }

    const response = await fetch(
        `https://www.virustotal.com/api/v3/analyses/${encodeURIComponent(analysisId)}`,
        {
            headers: {
                "x-apikey": apiKey,
            },
            signal: AbortSignal.timeout(15000),
        }
    );

    if (!response.ok) {
        const error = new Error(
            response.status === 429
                ? "VirusTotal request quota reached. Try again later."
                : "Unable to retrieve scan result"
        );

        error.code = `VT_HTTP_${response.status}`;
        throw error;
    }

    const result = await response.json();
    console.log("VirusTotal response check:", {
        type: result.data?.type,
        idMatches: result.data?.id === analysisId,
        hasAttributes: Boolean(result.data?.attributes),
        status: result.data?.attributes?.status,
        apiError: result.error?.code,
    });

    if (
        result.data?.type !== "analysis" ||
        typeof result.data.id !== "string" ||
        !result.data.id ||
        !result.data.attributes ||
        !["queued", "in-progress", "completed"].includes(
            result.data.attributes.status
        )
    ) {
        throw new Error("VirusTotal returned an invalid analysis");
    }

    return result.data.attributes;
}
function classifyAnalysis(analysis) {
    if (
        analysis.status === "queued" ||
        analysis.status === "in-progress"
    ) {
        return "pending";
    }

    if (analysis.status !== "completed") {
        return "error";
    }

    const stats = analysis.stats;
    const categories = [
        "malicious",
        "suspicious",
        "undetected",
        "harmless",
        "timeout",
        "confirmed-timeout",
        "failure",
        "type-unsupported",
    ];

    if (
        !stats ||
        categories.some(
            key => !Number.isSafeInteger(stats[key]) || stats[key] < 0
        )
    ) {
        return "error";
    }

    if (stats.malicious > 0) {
        return "infected";
    }

    if (stats.suspicious > 0) {
        return "error";
    }

    const detectionFreeResults =
        stats.undetected + stats.harmless;

    return detectionFreeResults >= 10 ? "clean" : "error";
}
module.exports = {
    submitFileForScan,
    getScanAnalysis,
    classifyAnalysis,
};