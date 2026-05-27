// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.21;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

interface IERC4626 is IERC20 {
    function asset() external view returns (address);
}

interface InvestmentManagerLike {
    function processDeposit(address receiver, uint256 assets) external returns (uint256);
    function processMint(address receiver, uint256 shares) external returns (uint256);
    function maxDeposit(address user, address _tranche) external view returns (uint256);
    function maxMint(address user, address _tranche) external view returns (uint256);
    function requestDeposit(uint256 assets, address receiver) external;
}

contract Auth {
    mapping (address => uint) public wards;
    function rely(address usr) external auth { wards[usr] = 1; }
    function deny(address usr) external auth { wards[usr] = 0; }
    modifier auth {
        require(wards[msg.sender] == 1, "not-authorized");
        _;
    }
}

contract LiquidityPool is Auth {
    uint64 public poolId;
    bytes16 public trancheId;
    address public immutable asset;
    address public immutable share;
    InvestmentManagerLike public investmentManager;

    constructor(uint64 poolId_, bytes16 trancheId_, address asset_, address share_, address investmentManager_) {
        poolId = poolId_;
        trancheId = trancheId_;
        asset = asset_;
        share = share_;
        investmentManager = InvestmentManagerLike(investmentManager_);
        wards[msg.sender] = 1;
    }

    modifier withApproval(address owner) {
        require(msg.sender == owner, "LiquidityPool/no-approval");
        _;
    }

    function deposit(uint256 assets, address receiver) public withApproval(receiver) returns (uint256 shares) {
        shares = investmentManager.processDeposit(receiver, assets);
    }

    function mint(uint256 shares, address receiver) public withApproval(receiver) returns (uint256 assets) {
        assets = investmentManager.processMint(receiver, shares);
    }

    function maxDeposit(address receiver) public view returns (uint256) {
        return investmentManager.maxDeposit(receiver, address(this));
    }

    function maxMint(address receiver) external view returns (uint256 maxShares) {
        return investmentManager.maxMint(receiver, address(this));
    }
}
