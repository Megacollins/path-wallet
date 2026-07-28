// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// A dual-lane vault. Both a MetaMask (EVM) user and a Phantom (Solana) user
/// deposit and withdraw the SAME ERC-20 token (the wUSDC wrapper) into the SAME
/// state. On Rome a Solana user's balance is their wallet's SPL token account,
/// surfaced 1:1 as this wrapper — so the vault is a plain ERC-20 vault; the SDK's
/// two lanes (`submitRomeTx` and `submitRomeTxSolanaLane`) do the rest.
contract Vault {
    IERC20 public immutable token; // the wUSDC wrapper
    mapping(address => uint256) public balanceOf;
    uint256 public totalDeposits;
    event Deposited(address indexed who, uint256 amount);
    event Withdrawn(address indexed who, uint256 amount);

    constructor(IERC20 _token) { token = _token; }

    function deposit(uint256 amount) external {
        require(token.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        balanceOf[msg.sender] += amount;
        totalDeposits += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        totalDeposits -= amount;
        require(token.transfer(msg.sender, amount), "transfer failed");
        emit Withdrawn(msg.sender, amount);
    }
}
