#!/usr/bin/env node

import chalk from "chalk";
import { bundleFunctions } from "./bundler";
import hashesDiffer from "./differ/differ";
import calculateHash from "./hasher/hasher";
import segregate from "./hasher/segregate";
import logger from "./logger";
import { dir, prefix, separator, specFilePath, write } from "./options/options";
import DifferSpec from "./parser/differSpec";
import parseSpecFile, { resolveFunctionPaths } from "./parser/parser";
import writeSpec from "./parser/writer";

async function main() {
    logger.info(`Parsing ${specFilePath}`);
    const specResult = await parseSpecFile(specFilePath);
    if (specResult.isErr()) {
        logger.error(specResult.error);
        return;
    }

    const { functions, hashes: existingHashes } = specResult.value;
    logger.info(`Discovered ${Object.keys(functions).length} functions`);

    const fxWithResolvedPaths = resolveFunctionPaths(functions, dir);
    const bundleResult = await bundleFunctions(fxWithResolvedPaths);
    if (bundleResult.isErr()) {
        logger.error("Encountered an error while bundling functions", bundleResult.error);
        return;
    }

    const bundles = bundleResult.value;
    const hashResults = bundles.map(({ fxName, code }) => calculateHash(fxName, code));
    const [hashes, hashErrors] = segregate(hashResults);

    if (hashErrors.length != 0) {
        logger.error(`Encountered ${hashErrors.length} while hashing functions`);
        hashErrors.forEach((err) => logger.error(err.error));
        return;
    }

    const newHashes = hashes
        .map((hash) => hash.value)
        .reduce((record, { fxName, hash }) => {
            record[fxName] = hash;
            return record;
        }, <Record<string, string>>{});

    const diffResults = hashesDiffer(existingHashes ?? {}, newHashes);

    const updatedSpec: DifferSpec = {
        functions,
        hashes: newHashes,
        lastDiff: diffResults,
    };

    Object.entries(newHashes).forEach(([fxName, fxHash]) => {
        logger.info(`${chalk.blue(fxName)}: ${chalk.green(fxHash)}`);
    });

    Object.entries(diffResults).forEach(([diffComponent, componentResults]) => {
        logger.info(`${chalk.yellow(diffComponent)}: ${chalk.green(componentResults)}`);
    });

    if (write) {
        const writeResult = await writeSpec(updatedSpec, specFilePath);
        if (writeResult.isErr()) {
            const error = writeResult.error;
            logger.error("Failed to update .differspec.json", error);
        }
    }

    const functionsToRedeploy = [...diffResults.added, ...diffResults.changed]
        .map((fxName) => `${prefix}${fxName}`)
        .join(separator);

    console.log(functionsToRedeploy);
}

main();
