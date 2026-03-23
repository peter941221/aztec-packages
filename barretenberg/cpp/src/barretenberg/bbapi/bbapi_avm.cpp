#include "barretenberg/bbapi/bbapi_avm.hpp"
#include "barretenberg/api/api_avm.hpp"

namespace bb::bbapi {

AvmProve::Response AvmProve::execute(const BBApiRequest& /*request*/) &&
{
    auto result = avm_prove_from_bytes(std::move(inputs));
    return Response{ .proof = std::move(result.proof), .verified = result.verified };
}

AvmVerify::Response AvmVerify::execute(const BBApiRequest& /*request*/) &&
{
    bool verified = avm_verify_from_bytes(std::move(proof), std::move(public_inputs));
    return Response{ .verified = verified };
}

AvmCheckCircuit::Response AvmCheckCircuit::execute(const BBApiRequest& /*request*/) &&
{
    bool passed = avm_check_circuit_from_bytes(std::move(inputs));
    return Response{ .passed = passed };
}

} // namespace bb::bbapi
