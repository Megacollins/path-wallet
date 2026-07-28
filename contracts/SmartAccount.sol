// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Path SmartAccount
/// @notice A modular smart account for Rome Protocol that is owned by BOTH lanes.
///
/// On Rome, two wallets reach the same state:
///   - an EVM (MetaMask) user acts from their EOA — `msg.sender` is that EOA;
///   - a Solana (Phantom) user acts from their *synthetic address*, a Rome-derived
///     PDA (`external_auth`) — `msg.sender` is that synthetic EVM address.
///
/// Because Rome surfaces the Solana user as an ordinary `address`, this account
/// treats both identically: an owner is simply an `address`, whether it is an EVM
/// EOA or a Solana synthetic. One account, driven by either lane, over one state.
///
/// The account is modular by design. Modules are contracts granted the right to
/// `execute` on the account's behalf — the extension point for session keys,
/// social recovery, spend limits, gas abstraction, and agent mode. An optional
/// `guard` module is consulted before every execution, giving policy modules
/// (spend limits, session-key scopes) a first-class hook without touching core.
interface IAccountModule {
    /// @notice Called when the module is enabled on an account.
    function onInstall(bytes calldata data) external;
    /// @notice Called when the module is disabled on an account.
    function onUninstall(bytes calldata data) external;
}

interface IAccountGuard {
    /// @notice Consulted before every execution. Revert to block.
    /// @param account The SmartAccount performing the call.
    /// @param caller  The owner or module that initiated the call.
    function preExecute(
        address account,
        address caller,
        address to,
        uint256 value,
        bytes calldata data
    ) external;
}

contract SmartAccount {
    /* ---------------------------------------------------------------- events */
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ModuleEnabled(address indexed module);
    event ModuleDisabled(address indexed module);
    event GuardChanged(address indexed guard);
    event Executed(address indexed to, uint256 value, bytes data);
    event Received(address indexed from, uint256 value);

    /* ----------------------------------------------------------------- state */
    /// @dev An owner is an address on either lane: an EVM EOA or a Solana synthetic.
    mapping(address => bool) public isOwner;
    uint256 public ownerCount;

    /// @dev Modules authorized to call {execute} / {executeBatch}.
    mapping(address => bool) public isModule;

    /// @dev Optional policy hook consulted before every execution (0 = none).
    address public guard;

    /* ------------------------------------------------------------- modifiers */
    modifier onlySelfOrOwner() {
        require(msg.sender == address(this) || isOwner[msg.sender], "SA: not owner");
        _;
    }

    modifier onlyOwnerOrModule() {
        require(isOwner[msg.sender] || isModule[msg.sender], "SA: not authorized");
        _;
    }

    /* ----------------------------------------------------------- constructor */
    /// @param initialOwner First owner — an EVM EOA or a Solana synthetic address.
    constructor(address initialOwner) {
        require(initialOwner != address(0), "SA: zero owner");
        isOwner[initialOwner] = true;
        ownerCount = 1;
        emit OwnerAdded(initialOwner);
    }

    /* ------------------------------------------------------ owner management */
    /// @notice Add an owner. Lets a user attach their *other* lane — e.g. an
    ///         EVM user adds their Phantom synthetic address, so one account is
    ///         controlled from both MetaMask and Phantom.
    function addOwner(address owner) external onlySelfOrOwner {
        require(owner != address(0), "SA: zero owner");
        require(!isOwner[owner], "SA: already owner");
        isOwner[owner] = true;
        ownerCount += 1;
        emit OwnerAdded(owner);
    }

    /// @notice Remove an owner. The account must always keep at least one.
    function removeOwner(address owner) external onlySelfOrOwner {
        require(isOwner[owner], "SA: not owner");
        require(ownerCount > 1, "SA: last owner");
        isOwner[owner] = false;
        ownerCount -= 1;
        emit OwnerRemoved(owner);
    }

    /* ----------------------------------------------------- module management */
    /// @notice Enable a module and run its install hook.
    function enableModule(address module, bytes calldata initData) external onlySelfOrOwner {
        require(module != address(0), "SA: zero module");
        require(!isModule[module], "SA: module enabled");
        isModule[module] = true;
        IAccountModule(module).onInstall(initData);
        emit ModuleEnabled(module);
    }

    /// @notice Disable a module and run its uninstall hook.
    function disableModule(address module, bytes calldata data) external onlySelfOrOwner {
        require(isModule[module], "SA: module disabled");
        isModule[module] = false;
        IAccountModule(module).onUninstall(data);
        emit ModuleDisabled(module);
    }

    /// @notice Set (or clear, with address(0)) the pre-execution policy guard.
    function setGuard(address newGuard) external onlySelfOrOwner {
        guard = newGuard;
        emit GuardChanged(newGuard);
    }

    /* -------------------------------------------------------------- execute */
    /// @notice Execute an arbitrary call from the account. Callable by any owner
    ///         (either lane) or any enabled module.
    function execute(address to, uint256 value, bytes calldata data)
        external
        onlyOwnerOrModule
        returns (bytes memory result)
    {
        result = _execute(to, value, data);
    }

    /// @notice Execute a batch of calls atomically.
    function executeBatch(
        address[] calldata to,
        uint256[] calldata value,
        bytes[] calldata data
    ) external onlyOwnerOrModule returns (bytes[] memory results) {
        require(to.length == value.length && value.length == data.length, "SA: length mismatch");
        results = new bytes[](to.length);
        for (uint256 i = 0; i < to.length; i++) {
            results[i] = _execute(to[i], value[i], data[i]);
        }
    }

    function _execute(address to, uint256 value, bytes calldata data) internal returns (bytes memory) {
        if (guard != address(0)) {
            IAccountGuard(guard).preExecute(address(this), msg.sender, to, value, data);
        }
        (bool ok, bytes memory ret) = to.call{value: value}(data);
        if (!ok) {
            // bubble the revert reason
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        emit Executed(to, value, data);
        return ret;
    }

    /* --------------------------------------------------------------- assets */
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }
}
