// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.0;

import "contracts/SHAPEToken.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract SHAPEVesting is Initializable, OwnableUpgradeable {
    using SafeERC20Upgradeable for SHAPEToken;
    using SafeERC20Upgradeable for ERC20Upgradeable;

    struct Vesting {
        uint256 lock;
        uint256 vesting;
        uint256 initialAmount;
        uint256 claimed;
    }

    uint8 constant public TEAM = 1;
    uint8 constant public MARKETING = 2;
    uint8 constant public RESERVE = 3;
    uint8 constant public LIQUIDITY = 4;
    uint8 constant public TGE_UNLOCKED = 20;
    uint8 constant public PRICE_DECIMALS = 18;

    uint256 public price;
    uint256 public vestingStart;
    uint256 public lock;
    uint256 public vesting;
    mapping (uint8 => Vesting) public reserves;
    mapping (address => Vesting[]) public vestingSchedules;

    SHAPEToken private _shapeToken;
    ERC20Upgradeable private _USDT;
    ERC20Upgradeable private _BUSD;
    ERC20Upgradeable private _USDC;

    function initialize(
        address ownerAddress,
        address tokenAddr,
        address usdt,
        address busd,
        address usdc
    ) external initializer {
        __Ownable_init();

        _shapeToken = SHAPEToken(tokenAddr);
        _USDT = ERC20Upgradeable(usdt);
        _BUSD = ERC20Upgradeable(busd);
        _USDC = ERC20Upgradeable(usdc);

        uint8 decimals = _shapeToken.decimals();
        reserves[TEAM] = Vesting(12 * 30, 24 * 30, 100_000_000 * (10 ** decimals), 0);
        reserves[MARKETING] = Vesting(0, 24 * 30, 25_000_000 * (10 ** decimals), 0);
        reserves[RESERVE] = Vesting(0, 36 * 30, 50_000_000 * (10 ** decimals), 0);
        reserves[LIQUIDITY] = Vesting(0, 24 * 30, 50_000_000 * (10 ** decimals), 0);

        transferOwnership(ownerAddress);
    }

    function setVesting(uint16 lock_, uint16 vesting_) public onlyOwner {
        lock = lock_;
        vesting = vesting_;
    }

    function setPrice(uint256 amount) public onlyOwner {
        price = amount;
    }

    function setVestingStart(uint256 date) public onlyOwner {
        vestingStart = date;
    }

    function buyShapeBUSD(uint256 amount) public {
        uint256 price_ = _fixPrice(amount, _BUSD);
        _BUSD.safeTransferFrom(msg.sender, address(this), price_);
        vestingSchedules[msg.sender].push(Vesting(lock, vesting, amount, 0));
    }

    function buyShapeUSDT(uint256 amount) public {
        uint256 price_ = _fixPrice(amount, _USDT);
        _USDT.safeTransferFrom(msg.sender, address(this), price_);
        vestingSchedules[msg.sender].push(Vesting(lock, vesting, amount, 0));
    }

    function buyShapeUSDC(uint256 amount) public {
        uint256 price_ = _fixPrice(amount, _USDC);
        _USDC.safeTransferFrom(msg.sender, address(this), price_);
        vestingSchedules[msg.sender].push(Vesting(lock, vesting, amount, 0));
    }

    function addBuyer(address buyer, uint256 amount, uint256 lock_, uint256 vesting_) public onlyOwner {
        vestingSchedules[buyer].push(Vesting(lock_, vesting_, amount, 0));
    }

    function addReserve(uint8 type_, uint256 amount) public onlyOwner validReserveType(type_) {
        require(block.timestamp < vestingStart, "Vesting has already started.");

        _shapeToken.safeTransferFrom(owner(), address(this), amount);
        reserves[type_].initialAmount += amount;
    }

    function checkReserve(uint8 type_) public view validReserveType(type_) returns (uint256) {
        return reserves[type_].initialAmount - reserves[type_].claimed;
    }

    function checkMinExpectedReserve(uint8 type_) public view validReserveType(type_) returns (uint256) {
        uint256 tgeWithdrawable = _getTgeWithdrawable(type_);

        uint256 vestingMonths = _getVestedMonthsForReserve(type_);
        if (vestingMonths <= 0) {
            return reserves[type_].initialAmount - tgeWithdrawable;
        }

        if (vestingMonths >= reserves[type_].vesting / 30) {
            return 0;
        }

        uint256 perMonth = (reserves[type_].initialAmount - tgeWithdrawable) / (reserves[type_].vesting / 30);
        return reserves[type_].initialAmount - tgeWithdrawable - perMonth * vestingMonths;
    }

    function withdrawFromReserve(uint8 type_, uint256 amount) public onlyOwner validReserveType(type_) {
        require(
            reserves[type_].claimed < reserves[type_].initialAmount,
            "All tokens have been already claimed from this reserve."
        );

        uint256 tgeWithdrawable = _getTgeWithdrawable(type_);

        uint256 vestedMonths = _getVestedMonthsForReserve(type_);
        uint256 claimable = 0;
        if (vestedMonths == reserves[type_].vesting) {
            claimable = reserves[type_].initialAmount - reserves[type_].claimed;
        } else {
            claimable = tgeWithdrawable + (reserves[type_].initialAmount - tgeWithdrawable) / (reserves[type_].vesting / 30) * vestedMonths - reserves[type_].claimed;
        }

        require(amount <= claimable, "Requested more than allowed by the vesting schedule.");

        reserves[type_].claimed += amount;
        _shapeToken.safeTransfer(owner(), amount);
    }

    function claim(uint256 index) public {
        require(vestingSchedules[msg.sender].length > 0, "No vesting registered for your address.");
        require(index < vestingSchedules[msg.sender].length, "No schedule at that index.");

        Vesting storage schedule = vestingSchedules[msg.sender][index];

        require(
            schedule.claimed < schedule.initialAmount,
            "All tokens have been already claimed from this vesting schedule."
        );

        uint256 claimable = 0;

        if (schedule.vesting == 0) {
            int256 lockedDays = (int256(block.timestamp) - int256(vestingStart)) / 1 days;
            if (lockedDays >= int256(schedule.lock)) {
                claimable = schedule.initialAmount;
            }
        } else {
            int256 vestedDays = (int256(block.timestamp) - int256(vestingStart)) / 1 days - int256(schedule.lock);
            uint256 vestedMonths = vestedDays / 30 <= 0 ? 0 : Math.min(uint256(vestedDays / 30), schedule.vesting / 30);
            uint256 scheduleClaimable = schedule.initialAmount / (schedule.vesting / 30) * vestedMonths - schedule.claimed;
            if (vestedMonths == schedule.vesting / 30) { // Schedule finished.
                claimable = schedule.initialAmount - schedule.claimed;
            } else {
                claimable = scheduleClaimable;
            }
        }

        schedule.claimed += claimable;

        _shapeToken.safeTransfer(msg.sender, claimable);
    }

    function withdrawBUSD() public onlyOwner {
        uint256 balance = _BUSD.balanceOf(address(this));
        _BUSD.safeTransfer(owner(), balance);
    }

    function withdrawUSDT() public onlyOwner {
        uint256 balance = _USDT.balanceOf(address(this));
        _USDT.safeTransfer(owner(), balance);
    }

    function withdrawUSDC() public onlyOwner {
        uint256 balance = _USDC.balanceOf(address(this));
        _USDC.safeTransfer(owner(), balance);
    }

    function getVestingSchedule() public view returns (Vesting[] memory) {
        return vestingSchedules[msg.sender];
    }

    function _getVestedMonthsForReserve(uint8 type_) private view validReserveType(type_) returns (uint256) {
        int256 vestedDays = (int256(block.timestamp) - int256(vestingStart)) / 1 days - int256(reserves[type_].lock);
        int256 vestedMonths = vestedDays / 30;

        return vestedMonths <= 0 ? 0 : Math.min(uint256(vestedMonths), reserves[type_].vesting / 30);
    }

    function _fixPrice(uint256 amount, ERC20Upgradeable otherToken) private view returns (uint256) {
        if (PRICE_DECIMALS >= otherToken.decimals()) {
            return (amount * price / (10 ** PRICE_DECIMALS)) / (10 ** (PRICE_DECIMALS - otherToken.decimals()));
        } else {
            return (amount * price / (10 ** PRICE_DECIMALS)) * (10 ** (otherToken.decimals() - PRICE_DECIMALS));
        }
    }

    function _getTgeWithdrawable(uint8 type_) private view returns (uint256) {
        if (type_ == LIQUIDITY && block.timestamp > vestingStart) {
            return reserves[type_].initialAmount * TGE_UNLOCKED / 100;
        }
        return 0;
    }

    modifier validReserveType(uint8 type_) {
        require(type_ > 0 && type_ <= LIQUIDITY);
        _;
    }
}