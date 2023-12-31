pragma solidity ^0.4.11;

 /*
 * Contract that is working with ERC223 tokens
 */

/// @title ContractReceiver - Standard contract implementation for compatibility with ERC 223 tokens.


contract ContractReceiver {

    /*
        Public variables of the contract.
        Optional
     */

    address public owner;

    /// @dev Function that is called when a user or another contract wants to transfer funds.
    /// @param _from Transaction initiator, analogue of msg.sender
    /// @param _value Number of tokens to transfer.
    /// @param _data Data containig a function signature and/or parameters
    function tokenFallback(address _from, uint256 _value, bytes _data) external;
}
