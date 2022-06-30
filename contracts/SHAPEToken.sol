// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

contract SHAPEToken is Initializable, ERC20Upgradeable, OwnableUpgradeable {
    using SafeERC20Upgradeable for ERC20Upgradeable;

    uint8 constant private DECIMALS = 18;
    uint256 constant private MAX_SUPPLY = 1_000_000_000 * (10 ** DECIMALS);

    function initialize(
        address ownerAddress,
        uint256 initialSupply
    ) external initializer {
        __ERC20_init("inSHAPE", "SHAPE");
        __Ownable_init();

        _mint(msg.sender, initialSupply);

        transferOwnership(ownerAddress);
    }

    function mint(uint256 amount) public onlyOwner {
        _mint(owner(), amount);
    }

    function burn(uint256 amount) public onlyOwner {
        _burn(owner(), amount);
    }

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    function _mint(address account, uint256 amount) internal override {
        require(
            totalSupply() + amount <= MAX_SUPPLY,
            "SHAPE: Minting this amount would exceed maximum supply."
        );
        super._mint(account, amount);
    }
}