// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {ProofVerifier} from "./Types.sol";
import {ZKPassportRootVerifier} from "./ZKPassportRootVerifier.sol";

contract ZKPassportSubVerifier {
  address public immutable owner;
  ZKPassportRootVerifier public immutable rootVerifier;

  constructor(address _owner, ZKPassportRootVerifier _rootVerifier) {
    owner = _owner;
    rootVerifier = _rootVerifier;
  }

  function addProofVerifiers(ProofVerifier[] memory) external pure {}
}
