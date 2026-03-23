#pragma once
/**
 * @file bbapi_avm.hpp
 * @brief AVM-specific command definitions for the Barretenberg RPC API.
 *
 * This file contains command structures for AVM operations including proving,
 * verification, and circuit checking. When built with bb (non-AVM), these
 * commands return an error response. When built with bb-avm, they work normally.
 */
#include "barretenberg/bbapi/bbapi_shared.hpp"
#include "barretenberg/common/named_union.hpp"
#include "barretenberg/ecc/curves/bn254/fr.hpp"
#include "barretenberg/serialize/msgpack.hpp"
#include <cstdint>
#include <vector>

namespace bb::bbapi {

/**
 * @struct AvmProve
 * @brief Prove an AVM transaction from serialized inputs.
 * The inputs are opaque msgpack bytes of AvmProvingInputs.
 * After proving, the generated proof is also verified.
 */
struct AvmProve {
    static constexpr const char MSGPACK_SCHEMA_NAME[] = "AvmProve";

    struct Response {
        static constexpr const char MSGPACK_SCHEMA_NAME[] = "AvmProveResponse";

        std::vector<bb::fr> proof;
        bool verified;
        SERIALIZATION_FIELDS(proof, verified);
        bool operator==(const Response&) const = default;
    };

    std::vector<uint8_t> inputs;
    SERIALIZATION_FIELDS(inputs);
    Response execute(const BBApiRequest& request = {}) &&;
    bool operator==(const AvmProve&) const = default;
};

/**
 * @struct AvmVerify
 * @brief Verify an AVM proof against serialized public inputs.
 */
struct AvmVerify {
    static constexpr const char MSGPACK_SCHEMA_NAME[] = "AvmVerify";

    struct Response {
        static constexpr const char MSGPACK_SCHEMA_NAME[] = "AvmVerifyResponse";

        bool verified;
        SERIALIZATION_FIELDS(verified);
        bool operator==(const Response&) const = default;
    };

    std::vector<bb::fr> proof;
    std::vector<uint8_t> public_inputs;
    SERIALIZATION_FIELDS(proof, public_inputs);
    Response execute(const BBApiRequest& request = {}) &&;
    bool operator==(const AvmVerify&) const = default;
};

/**
 * @struct AvmCheckCircuit
 * @brief Check the AVM circuit from serialized inputs.
 */
struct AvmCheckCircuit {
    static constexpr const char MSGPACK_SCHEMA_NAME[] = "AvmCheckCircuit";

    struct Response {
        static constexpr const char MSGPACK_SCHEMA_NAME[] = "AvmCheckCircuitResponse";

        bool passed;
        SERIALIZATION_FIELDS(passed);
        bool operator==(const Response&) const = default;
    };

    std::vector<uint8_t> inputs;
    SERIALIZATION_FIELDS(inputs);
    Response execute(const BBApiRequest& request = {}) &&;
    bool operator==(const AvmCheckCircuit&) const = default;
};

} // namespace bb::bbapi
